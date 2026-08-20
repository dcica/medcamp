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
 * The service has NO cap row for this event at all — a configuration fault, not
 * a sold-out service. Kept distinct from OverCapacityError because the two need
 * opposite handling: a full cap is an expected, staff-handled outcome (the buyer
 * paid, staff refunds), while a missing row means the event was never fully
 * configured and every purchase of that service will fail. Collapsing the two
 * is exactly what hid a lost $61 order for a day — the webhook logged "over
 * capacity" for a cap sitting at 23/40.
 */
export class MissingCapError extends Error {
  constructor(public serviceKey: string) {
    super(`No capacity row configured for service "${serviceKey}"`);
    this.name = "MissingCapError";
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

  // Quantity-aware: a qty-5 merch line costs 5 × the unit price. Must match the
  // total confirmOrderPaid records, or Stripe under-collects and the ledger and
  // the charge disagree (only bites quantity-mode events — camps are all qty 1).
  const totalCents = order.lineItems.reduce(
    (s, li) => s + li.amountCents * li.quantity,
    0,
  );
  if (totalCents === 0) {
    throw new Error("Order total is $0 — confirm directly, no checkout needed.");
  }
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    // Carries the event back. Without ?event= a cancelling buyer landed on bare
    // /register and got whatever the fallback pool picked — a cancelled Diwali
    // buyer dropped onto Navratri's checkout. Read off the order, not threaded in.
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/register?event=${order.eventId}&cancelled=${order.id}`,
    customer_email: order.registrantEmail,
    // Webhook reads this to confirm the right order (decision #2).
    metadata: { orderId: order.id, orgId: order.orgId },
    // Comped ($0) lines are omitted — Stripe's hosted page is the payment
    // receipt, and our own /confirm page shows the full breakdown including
    // comps. Sending them would also risk a zero-amount line-item rejection.
    line_items: order.lineItems
      .filter((li) => li.amountCents > 0)
      .map((li) => ({
        quantity: li.quantity,
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
    const now = new Date();
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
        // quantity-aware: a qty-3 admission line consumes 3 cap units.
        counts.set(li.serviceTypeId, (counts.get(li.serviceTypeId) ?? 0) + li.quantity);
      }
    }
    for (const [serviceTypeId, qty] of counts) {
      const serviceKey =
        order.lineItems.find((li) => li.serviceTypeId === serviceTypeId)
          ?.serviceType?.key ?? serviceTypeId;

      // NEVER express this as $executeRaw / $queryRaw. An unqualified table name
      // in raw SQL resolves through the session's `search_path`, and Supabase's
      // transaction pooler does NOT reliably apply the connection string's
      // `?schema=` to every pooled backend: measured on the deployed test DB,
      // 5 of 24 pooled sessions reported `search_path = pg_catalog, public,
      // extensions` with no `test` in it. A raw `UPDATE service_caps` then hit
      // `public.service_caps`, matched nothing, and threw OverCapacityError on a
      // cap that was 23/40 — rolling back the whole confirmation, so a PAID
      // order silently reverted to PENDING (~1 in 5 confirmations). `prod` is a
      // named schema too, so the same coin flip applied to real money. Prisma
      // model operations always emit the schema explicitly
      // (UPDATE "test"."service_caps"), so the schema comes from the datasource
      // and cannot be lost. That is the entire point of this block.
      const cap = await tx.serviceCap.findUnique({
        where: { eventId_serviceTypeId: { eventId: order.eventId, serviceTypeId } },
        select: { capacity: true },
      });
      // No row at all ⇒ misconfigured event, not a sold-out service.
      if (!cap) throw new MissingCapError(serviceKey);

      // GUARANTEED: two concurrent confirmations cannot oversell. updateMany
      // compiles to ONE conditional UPDATE, so under READ COMMITTED Postgres
      // re-evaluates `sold <= capacity - qty` against the committed row version
      // after any concurrent writer commits, and two claims on the last seat
      // cannot both match. That is the property the old raw statement had, and
      // it is preserved.
      //
      // NOT guaranteed: `capacity` is read one statement earlier (Prisma cannot
      // compare column-to-column with arithmetic), so a coordinator LOWERING the
      // cap inside that window lets one already in-flight order commit against
      // the pre-edit limit — measured sold=33 against capacity=25. Accepted
      // deliberately: the same end state is already reachable through the admin
      // action's own unlocked read-then-write of `sold`
      // (src/app/admin/camps/[id]/services/actions.ts), nothing enforces
      // sold <= capacity at the DB, and one extra paid seat beats rejecting a
      // paid order. The durable fix is a CHECK ("sold" <= "capacity") constraint
      // plus catching the violation; that needs a migration, so it is a later
      // task — and it is NOT a licence to go back to $executeRaw (see above).
      const claimed = await tx.serviceCap.updateMany({
        where: {
          eventId: order.eventId,
          serviceTypeId,
          sold: { lte: cap.capacity - qty },
        },
        data: { sold: { increment: qty } },
      });
      // With the schema no longer in play, count === 0 has exactly one honest
      // meaning left: the cap is genuinely full.
      if (claimed.count === 0) throw new OverCapacityError(serviceKey);
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

    // ── Family membership: created/extended ONLY here, on confirmed payment ──
    // Previously done at cart creation, which let an abandoned PENDING order
    // mint a real (non-purgeable) membership term for free. Confirmation is the
    // authoritative step (decision #2), so the upsert belongs in this transaction.
    const membershipLine = order.lineItems.find((li) => li.membershipPlanId);
    if (membershipLine?.membershipPlanId) {
      const plan = await tx.membershipPlan.findUnique({
        where: { id: membershipLine.membershipPlanId },
      });
      if (plan) {
        const existing = await tx.member.findUnique({
          where: {
            orgId_email: { orgId: order.orgId, email: order.registrantEmail },
          },
        });
        // Extend from the later of now / current expiry (renewal stacks).
        const base =
          existing && existing.validTo > now ? existing.validTo : now;
        const validTo = new Date(base);
        validTo.setFullYear(validTo.getFullYear() + plan.termYears);

        await tx.member.upsert({
          where: {
            orgId_email: { orgId: order.orgId, email: order.registrantEmail },
          },
          update: {
            name: order.registrantName,
            phone: order.registrantPhone,
            planId: plan.id,
            partySize: plan.partySize,
            validTo,
          },
          create: {
            orgId: order.orgId,
            name: order.registrantName,
            email: order.registrantEmail,
            phone: order.registrantPhone,
            planId: plan.id,
            partySize: plan.partySize,
            validFrom: now,
            validTo,
          },
        });
      }
    }

    const totalCents = order.lineItems.reduce(
      (s, li) => s + li.amountCents * li.quantity,
      0,
    );

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
        // Line items (with their service type) drive the PAID block and the
        // will-call list in the confirmation email; the event carries venue,
        // times and the refund policy.
        include: { event: true, lineItems: { include: { serviceType: true } } },
      });
      await sendConfirmationEmail({
        to: order.registrantEmail,
        registrantName: order.registrantName,
        eventName: order.event.name,
        confirmUrl: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}`,
        campIds: result.campIds,
        lineItems: order.lineItems.map((li) => ({
          description: li.serviceType?.name ?? li.description,
          quantity: li.quantity,
          amountCents: li.amountCents,
        })),
        // Only `fulfillable` service types are physical goods handed over at
        // the gate — admission and fee lines have nothing to collect.
        merch: order.lineItems
          .filter((li) => li.serviceType?.fulfillable)
          .map((li) => ({
            description: li.serviceType?.name ?? li.description,
            quantity: li.quantity,
          })),
        totalPaidCents: order.lineItems.reduce(
          (s, li) => s + li.amountCents * li.quantity,
          0,
        ),
        venue: order.event.location,
        startsAt: order.event.startsAt,
        endsAt: order.event.endsAt,
        allowsRefunds: order.event.allowsRefunds,
      });
    }
    return result;
  });
}
