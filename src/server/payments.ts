import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { sendConfirmationEmail } from "@/lib/email";
import { formatCampId } from "@/lib/campId";

/**
 * The single PaymentService (locked decision #6). Every billable thing is a
 * LineItem; one ledger table records money movement. Confirmation is the ONLY
 * place an order becomes CONFIRMED — invoked by the Stripe webhook (decision #2,
 * webhook-authoritative) or by a till holder recording cash. It is idempotent
 * and does the cap decrement atomically at the DB (not app-layer).
 */

export class OverCapacityError extends Error {
  constructor(public serviceKey: string) {
    super(`Service "${serviceKey}" is at capacity`);
    this.name = "OverCapacityError";
  }
}

/**
 * Create a Stripe hosted Checkout session for a PENDING order (decision #7:
 * hosted Checkout, no native build). Returns the redirect URL. For a $0 order
 * there's nothing to charge — caller should confirm directly instead.
 */
export async function createCheckoutForOrder(orderId: string): Promise<string> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lineItems: true, event: true },
  });

  const totalCents = order.lineItems.reduce((s, li) => s + li.amountCents, 0);
  if (totalCents === 0) {
    throw new Error("Order total is $0 — confirm directly, no checkout needed.");
  }
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/register?cancelled=${order.id}`,
    customer_email: order.registrantEmail,
    // Webhook reads this to confirm the right order (decision #2).
    metadata: { orderId: order.id, orgId: order.orgId },
    line_items: order.lineItems.map((li) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: li.amountCents,
        product_data: { name: li.description },
      },
    })),
  });

  await db.payment.create({
    data: {
      orgId: order.orgId,
      orderId: order.id,
      method: "STRIPE",
      status: "PENDING",
      amountCents: totalCents,
      stripeCheckoutId: session.id,
    },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

type ConfirmInput = {
  method: "STRIPE" | "CASH" | "ZELLE" | "CHECK";
  stripePaymentIntentId?: string;
  stripeCheckoutId?: string;
  /** Guards against double-processing on webhook retries (decision #2). */
  idempotencyKey: string;
  cashTenderedCents?: number;
};

/**
 * Confirm a paid order. Idempotent: a retry with the same idempotencyKey, or an
 * order already CONFIRMED, is a no-op. Runs as one transaction:
 *   atomic cap decrement → assign campIds → mark paid → ledger → build route.
 */
export async function confirmOrderPaid(
  orderId: string,
  input: ConfirmInput,
): Promise<{ alreadyConfirmed: boolean; campIds: string[] }> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lineItems: { include: { serviceType: true } },
        attendees: true,
        event: { include: { stations: { where: { active: true } } } },
      },
    });

    // Atomic claim (idempotency + concurrency guard). Exactly one caller may
    // transition PENDING → CONFIRMED. The Stripe webhook, the Checkout success
    // page (synchronous verify), and a cash till can all race to confirm the
    // same order; this conditional UPDATE is the lock — Postgres re-checks the
    // WHERE after any concurrent writer commits, so the loser matches 0 rows.
    // count === 0 means the order was already confirmed (or never pending) → no-op.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: { status: "CONFIRMED", method: input.method },
    });
    if (claim.count === 0) {
      return {
        alreadyConfirmed: true,
        campIds: order.attendees.map((a) => a.campId).filter(Boolean) as string[],
      };
    }

    // ── Atomic capacity decrement (DB-enforced, not app-layer) ──
    const counts = new Map<string, number>(); // serviceTypeId -> qty
    for (const li of order.lineItems) {
      if (li.serviceTypeId) {
        counts.set(li.serviceTypeId, (counts.get(li.serviceTypeId) ?? 0) + 1);
      }
    }
    for (const [serviceTypeId, qty] of counts) {
      const affected = await tx.$executeRaw`
        UPDATE service_caps
        SET sold = sold + ${qty}
        WHERE "eventId" = ${order.eventId}
          AND "serviceTypeId" = ${serviceTypeId}
          AND sold + ${qty} <= capacity
      `;
      if (affected === 0) {
        const st = order.lineItems.find(
          (li) => li.serviceTypeId === serviceTypeId,
        )?.serviceType;
        throw new OverCapacityError(st?.key ?? serviceTypeId);
      }
    }

    // ── Assign campIds from the per-event sequence (atomic increment) ──
    const n = order.attendees.length;
    const ev = await tx.event.update({
      where: { id: order.eventId },
      data: { nextCampSeq: { increment: n } },
      select: { nextCampSeq: true, code: true },
    });
    let seq = ev.nextCampSeq - n; // first id in the reserved range

    const campIds: string[] = [];
    for (const att of order.attendees) {
      const campId = formatCampId(ev.code, seq++);
      campIds.push(campId);
      await tx.attendee.update({
        where: { id: att.id },
        data: { campId },
      });

      // ── One stored route per attendee (decision #5) ──
      for (const station of order.event.stations) {
        await tx.stationVisit.create({
          data: {
            attendeeId: att.id,
            stationId: station.id,
            sequence: station.sequence,
            status: "QUEUED",
          },
        });
      }
    }

    // ── Mark line items paid (order status already claimed above) ──
    await tx.lineItem.updateMany({
      where: { orderId: order.id },
      data: { status: "PAID" },
    });

    const totalCents = order.lineItems.reduce((s, li) => s + li.amountCents, 0);

    // ── Record/settle the payment + ledger (decision #6) ──
    const existing = input.stripeCheckoutId
      ? await tx.payment.findUnique({
          where: { stripeCheckoutId: input.stripeCheckoutId },
        })
      : null;

    const payment = existing
      ? await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: "SUCCEEDED",
            stripePaymentIntentId: input.stripePaymentIntentId,
            idempotencyKey: input.idempotencyKey,
            cashTenderedCents: input.cashTenderedCents,
          },
        })
      : await tx.payment.create({
          data: {
            orgId: order.orgId,
            orderId: order.id,
            method: input.method,
            status: "SUCCEEDED",
            amountCents: totalCents,
            stripePaymentIntentId: input.stripePaymentIntentId,
            idempotencyKey: input.idempotencyKey,
            cashTenderedCents: input.cashTenderedCents,
          },
        });

    await tx.ledgerEntry.create({
      data: {
        orgId: order.orgId,
        paymentId: payment.id,
        direction: "CREDIT",
        method: input.method,
        amountCents: totalCents,
        memo: `Order ${order.id} confirmed`,
      },
    });

    return { alreadyConfirmed: false, campIds };
  }).then(async (result) => {
    // Side-effect (email) outside the transaction so a slow provider can't hold
    // a DB lock. Re-read the confirmed order for the message.
    if (!result.alreadyConfirmed) {
      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { event: true },
      });
      await sendConfirmationEmail({
        to: order.registrantEmail,
        registrantName: order.registrantName,
        eventName: order.event.name,
        confirmUrl: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}`,
        campIds: result.campIds,
      });
    }
    return result;
  });
}
