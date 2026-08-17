import { z } from "zod";
import type { ServiceCap, ServiceType } from "@prisma/client";
import { db } from "@/lib/db";
import { resolvePrice } from "@/lib/pricing";

/**
 * Registration service. Creates a PENDING order from a validated submission;
 * payment confirmation (webhook or cash) is the authoritative step (payments.ts).
 * Prices come from the event's offerings, resolved through the single
 * resolvePrice (src/lib/pricing.ts) for the "online" channel — never the
 * client, and never re-resolved later: a LineItem's amountCents is frozen at
 * creation.
 *
 * Two modes, chosen by Event.collectsAttendeeDetails (server-authoritative):
 *   - ATTENDEE (medcamp/CAMP): one row per person with a profile + per-person
 *     services. Each attendee is a patient/ticket.
 *   - QUANTITY (admission/merch, e.g. a dandiya night): pick services × quantity.
 *     Each admission unit becomes an anonymous scannable attendee; merch is an
 *     order-level quantity line. No per-person details.
 *
 * Optional add-ons (both modes): a free-form donation, and a family membership.
 * On events that honor membership, buying one comps admission (non-fulfillable
 * services priced at 0 for this order).
 */

const attendeeInput = z.object({
  name: z.string().min(1, "Attendee name is required"),
  mailingAddress: z.string().optional(),
  serviceKeys: z.array(z.string()).min(1, "Pick at least one service"),
});

const quantityInput = z.object({
  serviceKey: z.string().min(1),
  quantity: z.number().int().min(0),
});

export const registrationSchema = z.object({
  eventId: z.string().min(1),
  registrant: z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().min(7, "Phone is required"),
  }),
  marketingConsent: z.boolean().default(false),
  membershipPlanId: z.string().optional(),
  donationCents: z.number().int().min(0).optional(),
  // Exactly one of these is used, per the event's mode.
  attendees: z.array(attendeeInput).optional(),
  quantities: z.array(quantityInput).optional(),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type CreatedOrder = {
  orderId: string;
  totalCents: number;
};

type Offering = ServiceCap & { serviceType: ServiceType };

type BaseOrder = {
  orgId: string;
  eventId: string;
  status: "PENDING";
  registrantName: string;
  registrantEmail: string;
  registrantPhone: string;
  marketingConsent: boolean;
  marketingConsentAt: Date | null;
};

export async function createRegistration(
  input: RegistrationInput,
): Promise<CreatedOrder> {
  const data = registrationSchema.parse(input);

  const event = await db.event.findUniqueOrThrow({
    where: { id: data.eventId },
    include: { org: true },
  });
  if (event.status !== "OPEN") {
    throw new Error("Registration for this event is not open.");
  }

  // This event's offerings (per-event price on the cap, server-side only).
  const offerings = await db.serviceCap.findMany({
    where: { eventId: event.id, serviceType: { active: true } },
    include: { serviceType: true },
  });
  const byKey = new Map(offerings.map((o) => [o.serviceType.key, o]));

  // Resolve membership plan + whether it comps admission here.
  const plan = data.membershipPlanId
    ? await db.membershipPlan.findFirst({
        where: { id: data.membershipPlanId, orgId: event.orgId, active: true },
      })
    : null;
  if (data.membershipPlanId && !plan) {
    throw new Error("Membership plan is not available.");
  }
  // How many admission units the membership comps — the plan's family party
  // size, NOT an unlimited discount. Previously a boolean that zeroed every
  // admission line on the order, so one membership could comp 200 tickets.
  const compUnits = plan && event.honorsMembership ? plan.partySize : 0;

  const baseOrder: BaseOrder = {
    orgId: event.orgId,
    eventId: event.id,
    status: "PENDING",
    registrantName: data.registrant.name,
    registrantEmail: data.registrant.email,
    registrantPhone: data.registrant.phone,
    marketingConsent: data.marketingConsent,
    marketingConsentAt: data.marketingConsent ? new Date() : null,
  };

  // Resolved once and reused for every line on this order — price resolution
  // happens here, before any line exists, and never again (a LineItem's
  // amountCents is frozen at creation; confirmation must not re-resolve it).
  const now = new Date();

  // Mode-specific: create the order + attendees + service line items.
  const { orderId, serviceTotalCents } = event.collectsAttendeeDetails
    ? await createAttendeeOrder(event.orgId, event.id, baseOrder, data, byKey, compUnits, now)
    : await createQuantityOrder(event.orgId, event.id, baseOrder, data, byKey, compUnits, now);

  let total = serviceTotalCents;

  // Donation (variable, order-level, flagged for reconciliation).
  const donationCents = data.donationCents ?? 0;
  if (donationCents > 0) {
    await db.lineItem.create({
      data: {
        orgId: event.orgId,
        orderId,
        isDonation: true,
        description: "Donation",
        amountCents: donationCents,
        status: "PENDING_PAYMENT",
      },
    });
    total += donationCents;
  }

  // Membership: a line item only. The Member row is created/extended by
  // confirmOrderPaid, NOT here — an unpaid PENDING order must never mint a
  // membership term (decision #2: payment confirmation is authoritative).
  if (plan) {
    await db.lineItem.create({
      data: {
        orgId: event.orgId,
        orderId,
        membershipPlanId: plan.id,
        description: plan.name,
        amountCents: plan.priceCents,
        status: "PENDING_PAYMENT",
      },
    });
    total += plan.priceCents;
  }

  // Finalize payment method now that the grand total is known.
  await db.order.update({
    where: { id: orderId },
    data: { method: total === 0 ? "CASH" : "STRIPE" },
  });

  return { orderId, totalCents: total };
}

/** ATTENDEE mode: one attendee per person, per-person services (camp/patient). */
async function createAttendeeOrder(
  orgId: string,
  eventId: string,
  baseOrder: BaseOrder,
  data: RegistrationInput,
  byKey: Map<string, Offering>,
  compUnits: number,
  now: Date,
): Promise<{ orderId: string; serviceTotalCents: number }> {
  const attendees = data.attendees ?? [];
  if (attendees.length === 0) throw new Error("Add at least one attendee.");

  for (const att of attendees) {
    for (const key of att.serviceKeys) {
      if (!byKey.has(key)) {
        throw new Error(`Service not offered at this event: ${key}`);
      }
    }
  }

  // Membership comps the first `compUnits` admission (non-fulfillable) units;
  // everything beyond the family's party size is charged. Priced in ONE pass so
  // the allowance is spent once — the totals and the line items read the same
  // array rather than each re-running the allocation. A comp zeroes the
  // resolved (online/early-bird) price, never bypasses resolution.
  let compRemaining = compUnits;
  const priced = attendees.map((att) =>
    att.serviceKeys.map((key) => {
      const offering = byKey.get(key)!;
      const comped = offering.serviceType.admits && compRemaining > 0;
      if (comped) compRemaining -= 1;
      const resolved = resolvePrice(offering, "online", now);
      return { offering, resolved, amountCents: comped ? 0 : resolved.amountCents };
    }),
  );

  const serviceTotalCents = priced
    .flat()
    .reduce((s, p) => s + p.amountCents, 0);

  const order = await db.order.create({
    data: {
      ...baseOrder,
      attendees: {
        create: attendees.map((att) => ({
          orgId,
          eventId,
          name: att.name,
          mailingAddress: att.mailingAddress,
        })),
      },
    },
    include: { attendees: true },
  });

  const lineItemData = attendees.flatMap((att, i) => {
    const attendee = order.attendees[i];
    return priced[i].map(({ offering, resolved, amountCents }) => ({
      orgId,
      orderId: order.id,
      attendeeId: attendee.id,
      serviceTypeId: offering.serviceType.id,
      description:
        `${offering.serviceType.name} — ${att.name}` +
        (amountCents === 0 && resolved.amountCents > 0 ? " (member comp)" : ""),
      amountCents,
      status: "PENDING_PAYMENT" as const,
    }));
  });
  await db.lineItem.createMany({ data: lineItemData });

  return { orderId: order.id, serviceTotalCents };
}

/**
 * QUANTITY mode: service × quantity. Each admission unit (non-fulfillable
 * service) becomes one anonymous scannable attendee; merch (fulfillable) is an
 * order-level quantity line. If only merch is bought, one pickup-holder attendee
 * is created so there's still a scannable code for will-call at the gate.
 */
async function createQuantityOrder(
  orgId: string,
  eventId: string,
  baseOrder: BaseOrder,
  data: RegistrationInput,
  byKey: Map<string, Offering>,
  compUnits: number,
  now: Date,
): Promise<{ orderId: string; serviceTotalCents: number }> {
  const picked = (data.quantities ?? []).filter((q) => q.quantity > 0);
  if (picked.length === 0) throw new Error("Pick at least one item.");

  for (const q of picked) {
    if (!byKey.has(q.serviceKey)) {
      throw new Error(`Service not offered at this event: ${q.serviceKey}`);
    }
  }

  // Membership comps the first `compUnits` admission units; the rest are
  // charged. A partially-comped pick splits into TWO lines (qty N @ $0 and
  // qty M @ price) because a LineItem carries one unit price for its quantity —
  // a family of 6 with a 4-person membership pays for 2. A comp zeroes the
  // resolved (online/early-bird) price, never bypasses resolution.
  let compRemaining = compUnits;
  const priced = picked.flatMap((q) => {
    const offering = byKey.get(q.serviceKey)!;
    const isAdmission = offering.serviceType.admits;
    const compQty = isAdmission ? Math.min(compRemaining, q.quantity) : 0;
    compRemaining -= compQty;
    const paidQty = q.quantity - compQty;
    const resolved = resolvePrice(offering, "online", now);

    const lines: {
      offering: Offering;
      amountCents: number;
      quantity: number;
      comped: boolean;
    }[] = [];
    if (compQty > 0) {
      lines.push({ offering, amountCents: 0, quantity: compQty, comped: true });
    }
    if (paidQty > 0) {
      lines.push({
        offering,
        amountCents: resolved.amountCents,
        quantity: paidQty,
        comped: false,
      });
    }
    return lines;
  });

  const serviceTotalCents = priced.reduce(
    (s, p) => s + p.amountCents * p.quantity,
    0,
  );

  // Only admission units mint a scannable ticket. A fee (competition entry —
  // neither admission nor merch) mints none: 3 groups entering the competition
  // is one line, not 3 tickets, and grants nobody floor access.
  const admissionUnits = picked
    .filter((q) => byKey.get(q.serviceKey)!.serviceType.admits)
    .reduce((s, q) => s + q.quantity, 0);
  // Merch- or fee-only orders still get ONE code so the buyer has something to
  // scan at the desk — a receipt, not an admission.
  const ticketCount = admissionUnits > 0 ? admissionUnits : 1;

  const order = await db.order.create({
    data: {
      ...baseOrder,
      attendees: {
        // Anonymous scannable tickets (No-PHI — no name/address in this mode).
        create: Array.from({ length: ticketCount }, () => ({ orgId, eventId })),
      },
    },
    include: { attendees: true },
  });

  const lineItemData = priced.map((p) => ({
    orgId,
    orderId: order.id,
    // Order-level (not per-person): the charge for N units of this service.
    serviceTypeId: p.offering.serviceType.id,
    description:
      p.offering.serviceType.name + (p.comped ? " (member comp)" : ""),
    amountCents: p.amountCents,
    quantity: p.quantity,
    status: "PENDING_PAYMENT" as const,
  }));
  await db.lineItem.createMany({ data: lineItemData });

  return { orderId: order.id, serviceTotalCents };
}
