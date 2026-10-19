import { ZodError } from "zod";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import type { PriceChannel } from "@/lib/pricing";
import { createRegistration } from "@/server/registration";
import { confirmOrderPaid, sendTicketEmailFor } from "@/server/payments";

/**
 * Record a payment that arrived OUTSIDE Stripe — a Zelle transfer, a mailed
 * cheque, cash at a table — from the registrations page, and email the
 * ticket. What scripts/mint-offline-order.ts did from a laptop, as a server
 * function the admin action calls, with the same two guarantees:
 *
 *   - the SAME createRegistration: prices come from the event's cap rows,
 *     never from the form, and the SAME confirmOrderPaid: caps are claimed,
 *     codes minted and one ledger row written exactly as for a card;
 *   - it is keyed on the PAYMENT REFERENCE (the Zelle confirmation, the cheque
 *     number, the receipt number), so entering the same payment twice cannot
 *     mint twice, and it REFUSES to confirm when the money received is not
 *     what the basket costs — the order is left PENDING, named in the reply,
 *     for a human to look at. A $27 Zelle against a $30 basket is not a sale.
 *
 * Quantity-mode events only, in this version: an attendee-mode order needs a
 * name and an address per head, which a desk volunteer should not be inventing
 * from a bank transfer. The script still covers that case.
 *
 * NEVER reachable from the scan station (verify-gate pins it): a door screen
 * that could mint and confirm an order would be a way to admit a party with
 * no till and no money.
 */
export type OfflineMethod = "ZELLE" | "CHECK" | "CASH";

/** A registration needs a phone; a bank transfer carries none. A sentinel is honest, an invented number is not. */
export const PHONE_SENTINEL = "000-000-0000";

export type OfflinePaymentInput = {
  eventId: string;
  registrant: { name: string; email: string; phone?: string };
  items: { serviceKey: string; quantity: number }[];
  method: OfflineMethod;
  /** What was actually received, integer cents. Must equal the basket. */
  amountCents: number;
  /** The payment's own reference. Unique per payment; the idempotency key. */
  ref: string;
  /** "online" (the advertised price; money that arrived before the event) or "door". */
  channel?: PriceChannel;
};

export type OfflinePaymentOutcome =
  | {
      ok: true;
      orderId: string;
      campIds: string[];
      /** The reference was already confirmed earlier and nothing changed. */
      alreadyConfirmed: boolean;
      /** Whether the ticket email reached a provider (the console path is not delivery). */
      emailDelivered: boolean;
    }
  | {
      ok: false;
      reason: "duplicate-ref" | "amount-mismatch" | "attendee-mode" | "refused";
      message: string;
      /** For amount-mismatch: the PENDING order left behind, and what it costs. */
      orderId?: string;
      totalCents?: number;
    };

function messageOf(err: unknown): string {
  if (err instanceof ZodError) {
    const messages = [...new Set(err.issues.map((i) => i.message))];
    return messages.length > 0 ? messages.join("; ") : "Please check the details and try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "That could not be recorded.";
}

export async function recordOfflinePayment(
  orgId: string,
  input: OfflinePaymentInput,
): Promise<OfflinePaymentOutcome> {
  const ref = input.ref.trim();
  if (!ref) {
    return {
      ok: false,
      reason: "refused",
      message: "A payment reference is required — the Zelle confirmation, cheque number or receipt number.",
    };
  }
  const amountCents = Math.round(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "refused", message: "Enter the amount received." };
  }

  // Same sentence as "missing": a different one would tell a probe which ids are real.
  const event = await db.event.findFirst({
    where: { id: input.eventId, orgId },
    select: { id: true, collectsAttendeeDetails: true },
  });
  if (!event) return { ok: false, reason: "refused", message: "That event could not be found." };
  if (event.collectsAttendeeDetails) {
    return {
      ok: false,
      reason: "attendee-mode",
      message:
        "This event collects per-person details, which cannot be invented from a payment. Record it with the offline script, or switch the event to quantity mode.",
    };
  }

  // SCOPED to the organisation: Order.idempotencyKey is unique across the whole
  // database, and cheque 1001 or a short Zelle confirmation exists in every
  // organisation. A bare reference would refuse the second tenant's cheque as
  // "already recorded" — and tell it so, which is an oracle on another
  // tenant's payments.
  const scopedRef = `${orgId}:${ref}`;
  const prior = await db.order.findUnique({
    where: { idempotencyKey: scopedRef },
    select: { id: true, status: true, eventId: true },
  });

  let orderId: string;
  if (prior) {
    if (prior.eventId !== event.id || prior.status === "CONFIRMED") {
      return {
        ok: false,
        reason: "duplicate-ref",
        message: `Reference ${ref} was already recorded (order ${prior.id}).`,
        orderId: prior.id,
      };
    }
    // A reference whose confirmation failed midway: finish it, mint nothing new.
    orderId = prior.id;
  } else {
    let created: { orderId: string; totalCents: number };
    try {
      created = await createRegistration(
        {
          eventId: event.id,
          registrant: {
            name: input.registrant.name,
            email: input.registrant.email,
            phone: input.registrant.phone?.trim() || PHONE_SENTINEL,
          },
          quantities: input.items,
          marketingConsent: false,
        },
        { channel: input.channel ?? "online", orgId },
      );
    } catch (err) {
      return { ok: false, reason: "refused", message: messageOf(err) };
    }
    orderId = created.orderId;
    if (created.totalCents !== amountCents) {
      return {
        ok: false,
        reason: "amount-mismatch",
        orderId,
        totalCents: created.totalCents,
        message: `The basket costs ${formatCents(created.totalCents)} but ${formatCents(amountCents)} was received — left unconfirmed as order ${orderId}. Fix the items or the amount and record it again.`,
      };
    }
    await db.order.update({ where: { id: orderId }, data: { idempotencyKey: scopedRef } });
  }

  // `historical` suppresses the automatic ticket email and the analytics
  // purchase event; the ticket is then sent HERE, through the shared builder,
  // so the desk sees whether it was delivered — and a staff-keyed Zelle is
  // not a web purchase for analytics to count either way.
  const { alreadyConfirmed, campIds } = await confirmOrderPaid(orderId, {
    method: input.method,
    idempotencyKey: `offline-${scopedRef}`,
    historical: true,
  });
  const { delivered } = await sendTicketEmailFor(orderId);
  return { ok: true, orderId, campIds, alreadyConfirmed, emailDelivered: delivered };
}
