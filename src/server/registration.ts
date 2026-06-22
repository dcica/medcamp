import { z } from "zod";
import type { ServiceCap, ServiceType } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Registration service. Creates a PENDING order from a validated submission;
 * payment confirmation (webhook or cash) is the authoritative step (payments.ts).
 * Prices come from the event's offerings (ServiceCap.priceCents), never the client.
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
  const comp = Boolean(plan) && event.honorsMembership;

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

  // Mode-specific: create the order + attendees + service line items.
  const { orderId, serviceTotalCents } = event.collectsAttendeeDetails
    ? await createAttendeeOrder(event.orgId, event.id, baseOrder, data, byKey, comp)
    : await createQuantityOrder(event.orgId, event.id, baseOrder, data, byKey, comp);

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

  // Membership: create/extend the family member + a membership line item.
  if (plan) {
    await upsertMember(event.orgId, plan, data.registrant);
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

/** Create/extend a family membership for this registrant (org-scoped, by email). */
async function upsertMember(
  orgId: string,
  plan: { id: string; termYears: number; partySize: number },
  registrant: { name: string; email: string; phone: string },
): Promise<void> {
  const now = new Date();
  const existing = await db.member.findUnique({
    where: { orgId_email: { orgId, email: registrant.email } },
  });
  // Extend from the later of now / current expiry (renewal stacks).
  const base = existing && existing.validTo > now ? existing.validTo : now;
  const validTo = new Date(base);
  validTo.setFullYear(validTo.getFullYear() + plan.termYears);

  await db.member.upsert({
    where: { orgId_email: { orgId, email: registrant.email } },
    update: {
      name: registrant.name,
      phone: registrant.phone,
      planId: plan.id,
      partySize: plan.partySize,
      validTo,
    },
    create: {
      orgId,
      name: registrant.name,
      email: registrant.email,
      phone: registrant.phone,
      planId: plan.id,
      partySize: plan.partySize,
      validFrom: now,
      validTo,
    },
  });
}

/** ATTENDEE mode: one attendee per person, per-person services (camp/patient). */
async function createAttendeeOrder(
  orgId: string,
  eventId: string,
  baseOrder: BaseOrder,
  data: RegistrationInput,
  byKey: Map<string, Offering>,
  comp: boolean,
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

  // Membership comps admission (non-fulfillable) services for this order.
  const priceFor = (o: Offering) =>
    comp && !o.serviceType.fulfillable ? 0 : o.priceCents;

  const serviceTotalCents = attendees.reduce(
    (sum, att) =>
      sum + att.serviceKeys.reduce((s, k) => s + priceFor(byKey.get(k)!), 0),
    0,
  );

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
    return att.serviceKeys.map((key) => {
      const offering = byKey.get(key)!;
      return {
        orgId,
        orderId: order.id,
        attendeeId: attendee.id,
        serviceTypeId: offering.serviceType.id,
        description: `${offering.serviceType.name} — ${att.name}`,
        amountCents: priceFor(offering),
        status: "PENDING_PAYMENT" as const,
      };
    });
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
  comp: boolean,
): Promise<{ orderId: string; serviceTotalCents: number }> {
  const picked = (data.quantities ?? []).filter((q) => q.quantity > 0);
  if (picked.length === 0) throw new Error("Pick at least one item.");

  for (const q of picked) {
    if (!byKey.has(q.serviceKey)) {
      throw new Error(`Service not offered at this event: ${q.serviceKey}`);
    }
  }

  const priceFor = (o: Offering) =>
    comp && !o.serviceType.fulfillable ? 0 : o.priceCents;

  const serviceTotalCents = picked.reduce(
    (s, q) => s + priceFor(byKey.get(q.serviceKey)!) * q.quantity,
    0,
  );

  const admissionUnits = picked
    .filter((q) => !byKey.get(q.serviceKey)!.serviceType.fulfillable)
    .reduce((s, q) => s + q.quantity, 0);
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

  const lineItemData = picked.map((q) => {
    const offering = byKey.get(q.serviceKey)!;
    return {
      orgId,
      orderId: order.id,
      // Order-level (not per-person): the charge for N units of this service.
      serviceTypeId: offering.serviceType.id,
      description: offering.serviceType.name,
      amountCents: priceFor(offering),
      quantity: q.quantity,
      status: "PENDING_PAYMENT" as const,
    };
  });
  await db.lineItem.createMany({ data: lineItemData });

  return { orderId: order.id, serviceTotalCents };
}
