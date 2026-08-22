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
 * On events that honor membership, buying one comps admission (ADMISSION-kind
 * services priced at 0 for this order).
 */

/**
 * `.trim()` BEFORE `.min()` on every required free-text field, throughout this
 * schema. zod counts a space, so a bare `.min(1)` accepts "   " and a bare
 * `.min(7)` accepts seven spaces — no crafted request needed, a thumb resting
 * on the spacebar of a 6" phone does it. What that costs: the name is what
 * `formatCampId` prints on the badge, so a whitespace name is a blank badge
 * that registration cannot match to a person at check-in, and a whitespace
 * phone is an unreachable contact on the ONLY record a camp keeps (No-PHI —
 * there is no second record to fall back on). `.trim()` is also a transform,
 * so a padded name is stored without its padding.
 *
 * Whenever a bound here tightens, tighten the matching client check in
 * `src/app/_components/ValidatedInput.tsx` in the same commit — see the
 * invariant recorded there.
 */
const attendeeInput = z.object({
  name: z.string().trim().min(1, "Attendee name is required"),
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
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().trim().min(7, "Phone is required"),
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

/**
 * Whether the public form may sell for this event right now.
 *
 * ONE predicate, called by both the page that renders the form and the action
 * that accepts it. They disagreed before: the page rendered a full checkout for
 * an ACTIVE event and the action then refused it, so the day a coordinator
 * flipped the event live, online registration became a dead end — the form took
 * a name, a phone and a total, then failed on submit. A walk-in told to
 * "register on your phone" at the door hit a wall.
 *
 * ACTIVE counts as open only once walk-in selling has been opened, which is what
 * `walkInOpensAt` already exists to express — being mid-event is not by itself
 * permission to keep selling online.
 *
 * An OPEN event that is over is closed whatever its status says, because status
 * is set by hand and nobody remembers: a finished event sat OPEN for six weeks
 * and kept taking money. The date test is `endsAt`, NOT `startsAt` — an event in
 * progress must keep selling to the crowd already in the room, and `startsAt`
 * would slam the form shut the instant the doors opened. Do not "simplify" it.
 *
 * The clock applies to OPEN ONLY (ruling, 2026-08-18). ACTIVE *with*
 * `walkInOpensAt` set is a coordinator's deliberate act today, and a door someone
 * opened outranks a scheduled end. The reason is that a CAMP has no gate sell
 * path — `src/server/gate.ts` filters `type: "GENERAL"` and there is no camp
 * equivalent of `sellAtGate` — so for a camp `/register` IS the walk-in path, the
 * one `walkInOpensAt` exists to open on camp day. A camp booked 8am–1pm that runs
 * to 2:30pm (routine for 300–500 patients) would otherwise lose walk-in
 * registration at 1:00pm sharp, with no fallback path of any kind.
 *
 * The residual hole, recorded rather than patched: an event left ACTIVE with
 * `walkInOpensAt` set stays sellable past its `endsAt` — through a direct
 * `?event=<id>` link, and as bare `/register`'s fallback candidate, whose pool
 * mirrors this predicate on purpose. On that page it is not merely reachable, it
 * is PREFERRED: the pool is ordered `endsAt` ASC and its ACTIVE arm carries no
 * date bound at all, so an event whose `endsAt` has passed sorts ahead of every
 * live OPEN event — and keeps winning, because every future event has a later
 * `endsAt`. One finished camp left un-CLOSED therefore owns the default
 * registration page indefinitely. That is why the CLOSED transition is
 * load-bearing rather than housekeeping: it is the only thing preventing that.
 * (On camp day the same inversion is exactly what you want — the camp actually
 * running should outrank an OPEN event three months out. It is wrong only in the
 * un-CLOSED tail.) The hole is not reachable from the public lists — `/events`
 * and `/` keep an unconditional `endsAt` filter, so a finished event still stops
 * being LISTED even while it stays sellable; that asymmetry is deliberate,
 * because a list is a browse surface where a finished event is just noise,
 * whereas a direct link or a coordinator-opened door is a deliberate act by
 * someone who means to register. The lifecycle (DRAFT → OPEN → ACTIVE → CLOSED)
 * is what closes the hole: closing the event is the fix. Do not add code to
 * compensate.
 *
 * `now` is injected so both sides of the boundary are testable without waiting
 * for the wall clock.
 */
export function isRegistrationOpen(
  event: {
    status: string;
    walkInOpensAt: Date | null;
    endsAt: Date;
  },
  now: Date = new Date(),
): boolean {
  if (event.status === "OPEN") return event.endsAt >= now;
  return event.status === "ACTIVE" && event.walkInOpensAt !== null;
}

export async function createRegistration(
  input: RegistrationInput,
  /**
   * INTERNAL. Only src/server/performance.ts passes this.
   *
   * A FEE-kind service is a competition entry,
   * and an entry without its group details is useless: it is a paid slot with no
   * group name, no song and nobody to contact about either. That is not
   * hypothetical — a $25 RoN entry was taken through /register with
   * `performanceEntry: NONE` because /register happily sold the fee.
   *
   * Hiding fee services from the /register PAGE is not enough, because the
   * action is reachable by a hand-rolled POST and by any stale bookmark. So the
   * refusal lives here, at the one chokepoint both flows share, and only
   * createPerformanceEntry — which writes the details in the same breath — is
   * allowed through.
   */
  opts?: { allowFeeServices?: boolean },
): Promise<CreatedOrder> {
  const data = registrationSchema.parse(input);

  // findUnique + explicit guard, NOT findUniqueOrThrow. Prisma's
  // NotFoundError is a plain Error whose message is a ~456-character dump
  // carrying the absolute path of THIS file and a numbered snippet of it, and
  // `toBuyerMessage` passes plain Errors through verbatim (by design, so the
  // buyer-facing throws below survive). A bogus eventId is reachable by editing
  // the POST body — exactly the person who must not be handed the server's
  // directory layout. The message below is a plain Error on purpose: it is
  // buyer copy, so passing through toBuyerMessage is intentional, not accidental.
  const event = await db.event.findUnique({
    where: { id: data.eventId },
    include: { org: true },
  });
  if (!event) {
    throw new Error("That event could not be found.");
  }
  if (!isRegistrationOpen(event)) {
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

  if (!opts?.allowFeeServices) {
    for (const q of data.quantities ?? []) {
      if (q.quantity <= 0) continue;
      const offering = byKey.get(q.serviceKey);
      if (
        offering &&
        offering.serviceType.kind === "FEE"
      ) {
        throw new Error(
          "That entry has its own form — please use the performance entry page.",
        );
      }
    }
  }

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

  // Membership comps the first `compUnits` ADMISSION units;
  // everything beyond the family's party size is charged. Priced in ONE pass so
  // the allowance is spent once — the totals and the line items read the same
  // array rather than each re-running the allocation. A comp zeroes the
  // resolved (online/early-bird) price, never bypasses resolution.
  let compRemaining = compUnits;
  const priced = attendees.map((att) =>
    att.serviceKeys.map((key) => {
      const offering = byKey.get(key)!;
      const comped = offering.serviceType.kind === "ADMISSION" && compRemaining > 0;
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
 * QUANTITY mode: service × quantity. Each ADMISSION unit becomes one anonymous
 * scannable attendee; MERCH is an
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
    const isAdmission = offering.serviceType.kind === "ADMISSION";
    // Heads per purchased unit — 1 for a plain ticket, 4 for a "family of 4".
    const heads = isAdmission ? Math.max(1, offering.serviceType.admitsCount) : 0;
    // Comps are whole units. A membership with 4 comp units meeting a family-of-4
    // bundle comps the one bundle; meeting a family-of-6 bundle comps nothing,
    // because a bundle cannot be half free — a LineItem carries one unit price
    // for its quantity, and there is no way to admit 4 of the 6 people it mints.
    const compQty = isAdmission
      ? Math.min(Math.floor(compRemaining / heads), q.quantity)
      : 0;
    compRemaining -= compQty * heads;
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
  //
  // Multiplied by admitsCount, so a gate bundle mints a code PER PERSON rather
  // than per purchase: one "family of 4" is one line and four scannable codes,
  // because four people walk through the door and each needs something to show.
  const admissionUnits = picked
    .filter((q) => byKey.get(q.serviceKey)!.serviceType.kind === "ADMISSION")
    .reduce(
      (s, q) =>
        s + q.quantity * Math.max(1, byKey.get(q.serviceKey)!.serviceType.admitsCount),
      0,
    );
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
