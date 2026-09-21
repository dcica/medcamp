import type { ServiceKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { normalizeCampId } from "@/lib/campId";
import { planTicketLookup } from "@/lib/ticketCode";
import { confirmOrderPaid } from "@/server/payments";
import { resolvePrice } from "@/lib/pricing";
import { NOT_A_TICKET, NOT_PAID } from "@/lib/scanVerdict";

/**
 * Gate service (general / ticketed events — e.g. a dandia dance night). The
 * scan→resolve primitive is shared with medcamp check-in, but the gate's job is
 * admission + will-call merch pickup + on-the-spot POS, NOT a clinical station
 * flow. All reads/writes are org-scoped (Approach C app-layer isolation).
 *
 * Re-entry is owned by a physical wristband, so `checkedInAt` here means
 * "processed at the gate" (don't double-issue), not a re-entry block.
 */

export type GatePickupItem = {
  lineItemId: string;
  name: string;
  fulfilledAt: Date | null;
};

/**
 * What one admit attempt actually DID.
 *
 * Returned rather than thrown for the two outcomes that are normal at a door:
 * it landed now, or it had already landed. `at` is the ORIGINAL admit time in
 * the "already" case, which is the whole value of it — "already in" is a shrug,
 * "already in at 7:42 PM" is something a volunteer can act on.
 */
export type AdmitResult =
  | { state: "admitted"; at: Date }
  | { state: "already"; at: Date };

export type GateView = {
  attendeeId: string;
  orderId: string;
  campId: string | null;
  name: string | null;
  eventId: string;
  eventName: string;
  /** Order is CONFIRMED (admission paid). */
  isPaid: boolean;
  /** Sum of any still-unpaid line items on the order (pay-at-gate amount). */
  amountOwedCents: number;
  /** checkedInAt is set — already processed at the gate. */
  alreadyAdmitted: boolean;
  admittedAt: Date | null;
  /** Pre-bought physical goods to hand over (MERCH line items). */
  pickupItems: GatePickupItem[];
};

/**
 * The ticketed event whose gate is being staffed. MVP: the single ACTIVE event
 * of type GENERAL (a coordinator runs one door). Newest by start time wins if
 * more than one is somehow active.
 */
export async function getActiveGeneralEvent() {
  const org = await getActiveOrg();
  if (!org) return null;
  return db.event.findFirst({
    where: { orgId: org.id, type: "GENERAL", status: "ACTIVE" },
    orderBy: { startsAt: "desc" },
  });
}

/**
 * Two different tickets end with the characters that were typed. Refused rather
 * than guessed: `isBareToken` makes this astronomically unlikely, but "the door
 * silently picked one of two people" is not a state worth leaving reachable on
 * an access path.
 */
export const AMBIGUOUS_TOKEN =
  "That code matches more than one ticket — scan it, or type the whole id.";

/** A real ticket, for a different event than the one this door is staffing. */
export function wrongEventMessage(ticketEventName: string): string {
  return `Wrong event — this ticket is for ${ticketEventName}.`;
}

const GATE_INCLUDE = {
  event: true,
  order: { include: { lineItems: { include: { serviceType: true } } } },
} as const;

/**
 * Typed from the client rather than declared, the same trick src/lib/db.ts uses
 * on its factory: the client `omit`s Event.internalNotes, so a hand-written
 * Prisma.AttendeeGetPayload would silently widen the type back.
 */
function findGateAttendee(where: { orgId: string; campId: string }) {
  return db.attendee.findFirst({ where, include: GATE_INCLUDE });
}
type GateAttendee = NonNullable<Awaited<ReturnType<typeof findGateAttendee>>>;

/**
 * Shape one attendee row into the door's view of them.
 *
 * Split out of getGateView because search has to produce the same thing from a
 * name lookup: if the two diverged, a guest found by name would render with
 * different rules than the same guest found by scanning.
 */
export function toGateView(attendee: GateAttendee): GateView {
  const amountOwedCents = attendee.order.lineItems
    .filter((li) => li.status === "PENDING_PAYMENT")
    .reduce((s, li) => s + li.amountCents * li.quantity, 0);

  // Merch to hand over: MERCH items attached to THIS ticket OR to the
  // order itself (quantity-mode merch is order-level). Quantity shown in name.
  const pickupItems = attendee.order.lineItems
    .filter(
      (li) =>
        li.serviceType?.kind === "MERCH" &&
        (li.attendeeId === attendee.id || li.attendeeId === null),
    )
    .map((li) => ({
      lineItemId: li.id,
      name:
        (li.serviceType?.name ?? li.description) +
        (li.quantity > 1 ? ` ×${li.quantity}` : ""),
      fulfilledAt: li.fulfilledAt,
    }));

  return {
    attendeeId: attendee.id,
    orderId: attendee.orderId,
    campId: attendee.campId,
    name: attendee.name,
    eventId: attendee.eventId,
    eventName: attendee.event.name,
    isPaid: attendee.order.status === "CONFIRMED",
    amountOwedCents,
    alreadyAdmitted: Boolean(attendee.checkedInAt),
    admittedAt: attendee.checkedInAt,
    pickupItems,
  };
}

/**
 * Resolve a scanned/typed code to a gate view within the active org.
 *
 * Pass `eventCode` — the event this door is staffing — and a volunteer may type
 * the bare token with no prefix. Two lookups, in order:
 *
 *   1. EXACT, on the canonical id. Unchanged from before, and still the only
 *      lookup when no eventCode is supplied, so every existing caller behaves
 *      identically.
 *   2. TOKEN SUFFIX, only when the typed value passes `isBareToken`. This is
 *      what lets a bare token resolve at ANY door — deliberately, because the
 *      case that happens is someone presenting a Garba ticket at the Dandiya
 *      gate, and staff need to SEE it resolve against the wrong event rather
 *      than read "no match" and wave them through a different queue.
 *
 * The suffix scan cannot use a B-tree, but @@index([orgId, eventId]) narrows to
 * one org first and an event's whole order book is small (src/server/
 * registrations.ts:80 records the ceiling: a 500-patient camp). It only runs
 * when the exact match already missed.
 */
export async function getGateView(
  rawCode: string,
  eventCode?: string,
): Promise<GateView | null> {
  const org = await getActiveOrg();
  if (!org) return null;

  const plan = eventCode
    ? planTicketLookup(eventCode, rawCode)
    : { exact: normalizeCampId(rawCode), tokenSuffix: null };
  if (plan === null) return null;

  const exact = await findGateAttendee({ orgId: org.id, campId: plan.exact });
  if (exact) return toGateView(exact);

  if (plan.tokenSuffix === null) return null;

  const matches = await db.attendee.findMany({
    where: { orgId: org.id, campId: { endsWith: `-${plan.tokenSuffix}` } },
    include: GATE_INCLUDE,
    take: 2,
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error(AMBIGUOUS_TOKEN);
  return toGateView(matches[0]);
}

/**
 * What the gate says when a code is real, paid, and still admits nobody — a
 * competition entry or a merch-only will-call receipt.
 *
 * Re-exported, not defined here. The wording lives in src/lib/scanVerdict.ts so
 * the screen that MATCHES it and the server that THROWS it cannot drift into
 * paraphrase, and so a tsx suite can load it without pulling in Prisma.
 */
export { NOT_A_TICKET, NOT_PAID } from "@/lib/scanVerdict";

/**
 * Does this purchase admit anyone at all?
 *
 * A FEE "buys a slot and admits nobody" (ServiceKind, schema.prisma) and merch
 * is a thing handed over, not a way in — yet `createQuantityOrder` still mints
 * ONE attendee for a fee- or merch-only order so the buyer has something to
 * scan at the desk. That code is a RECEIPT. Without this test the gate could not
 * tell it from a ticket: it is paid, it resolves, and admitting it both let a
 * competition entrant onto the floor for free and inflated the headcount the
 * hall's capacity is read from.
 *
 * An order with NO line items at all is admissible — that is the membership comp
 * (`compAdmit`), which is $0, carries no lines, and is a legitimate admission.
 */
export function admitsNobody(
  lineItems: { serviceType: { kind: ServiceKind } | null }[],
): boolean {
  return (
    lineItems.length > 0 &&
    !lineItems.some((li) => li.serviceType?.kind === "ADMISSION")
  );
}

/** Admit a paid attendee. Idempotent — a re-scan is a no-op (wristband owns re-entry). */
/**
 * Refuse a ticket that belongs to another event, WITHOUT writing anything.
 *
 * Exists separately from the identical check inside `admitAttendee` because
 * `confirmUnpaidAndAdmit` settles cash before it admits. Relying on the guard
 * inside admitAttendee there would take the money first and refuse second.
 */
export async function assertAttendeeAtEvent(
  attendeeId: string,
  expectedEventId: string,
): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const attendee = await db.attendee.findFirst({
    where: { id: attendeeId, orgId: org.id },
    select: { eventId: true, event: { select: { name: true } } },
  });
  if (!attendee) throw new Error("Attendee not found.");
  if (attendee.eventId !== expectedEventId) {
    throw new Error(wrongEventMessage(attendee.event.name));
  }
}

export async function admitAttendee(
  attendeeId: string,
  /**
   * The event this door is staffing. OPTIONAL, and that is deliberate: making
   * it required would rewrite every existing call site in one commit, which is
   * exactly the wide diff that makes a re-scan regression hard to spot.
   *
   * Supplying it closes a live hole. Until now this function resolved by
   * { id, orgId } with NO event check, so a Garba ticket admitted at the
   * Dandiya door read as paid and got `checkedInAt` stamped — and because
   * getEventHeadcount filters on eventId, the head then vanished from BOTH
   * counts and nothing surfaced it.
   */
  expectedEventId?: string,
): Promise<AdmitResult> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const attendee = await db.attendee.findFirst({
    where: { id: attendeeId, orgId: org.id },
    include: {
      event: true,
      order: { include: { lineItems: { include: { serviceType: true } } } },
    },
  });
  if (!attendee) throw new Error("Attendee not found.");
  // BEFORE the already-admitted early return, on purpose. A ticket from another
  // event that was legitimately admitted at ITS door must read "wrong event"
  // here, not a reassuring "already in".
  if (expectedEventId && attendee.eventId !== expectedEventId) {
    throw new Error(wrongEventMessage(attendee.event.name));
  }
  // REPORTED, not thrown. "They were already in" is a normal outcome at a door,
  // not an error — and it is the one the screen most needs to tell apart from a
  // fresh admit, because the two demand opposite physical actions. The early
  // return is byte-for-byte the same condition it always was, so re-scan
  // idempotency (verify-gate §5) is untouched: no second write, no second head,
  // and the ORIGINAL timestamp comes back rather than now.
  if (attendee.checkedInAt) {
    return { state: "already", at: attendee.checkedInAt };
  }
  // Refusals still throw. A refusal is not an outcome the door can act on.
  if (attendee.order.status !== "CONFIRMED") {
    throw new Error(NOT_PAID);
  }
  if (admitsNobody(attendee.order.lineItems)) throw new Error(NOT_A_TICKET);
  const at = new Date();
  await db.attendee.update({
    where: { id: attendee.id },
    data: { checkedInAt: at },
  });
  return { state: "admitted", at };
}

/**
 * Admit everyone an order actually bought entry for, and nobody it didn't.
 * Returns how many people this call put through the door — 0 for a fee-only or
 * merch-only sale, which is the point: the walk-up form sells competition
 * entries under a "NOT A TICKET · NO FLOOR ACCESS" banner, and the server has to
 * mean it. A no-op here is a completed sale, not a failure, so this returns a
 * count rather than throwing the way `admitAttendee` does on a scan.
 */
export async function admitOrderAttendees(orderId: string): Promise<number> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const order = await db.order.findFirst({
    where: { id: orderId, orgId: org.id },
    include: {
      lineItems: { include: { serviceType: true } },
      attendees: { select: { id: true, checkedInAt: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  if (admitsNobody(order.lineItems)) return 0;
  let admitted = 0;
  for (const attendee of order.attendees) {
    if (attendee.checkedInAt) continue;
    const result = await admitAttendee(attendee.id);
    if (result.state === "already") continue;
    admitted++;
  }
  return admitted;
}

/**
 * Hand over pre-bought merch. Idempotent — only stamps items not already
 * fulfilled, so a re-scan can't issue the same goods twice.
 */
export async function fulfillLineItems(
  lineItemIds: string[],
  userId: string,
): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  if (lineItemIds.length === 0) return;
  await db.lineItem.updateMany({
    where: { id: { in: lineItemIds }, orgId: org.id, fulfilledAt: null },
    data: { fulfilledAt: new Date(), fulfilledByUserId: userId },
  });
}

/** Hand over every MERCH item on an order (used right after a gate merch sale). */
export async function fulfillOrder(
  orderId: string,
  userId: string,
): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const items = await db.lineItem.findMany({
    where: { orderId, orgId: org.id, fulfilledAt: null },
    include: { serviceType: true },
  });
  await fulfillLineItems(
    items.filter((i) => i.serviceType?.kind === "MERCH").map((i) => i.id),
    userId,
  );
}

/**
 * Attested membership comp: admit 1–4 guests free. Creates a $0 CONFIRMED order
 * (method COMP, no Payment row) with that many already-admitted, anonymous
 * attendees (No-PHI — comps carry no personal detail). They count toward the
 * headcount uniformly with paid admits.
 */
export async function compAdmit(
  eventId: string,
  count: number,
  userId: string,
): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const n = Math.max(1, Math.min(4, Math.round(count)));
  const event = await db.event.findFirst({
    where: { id: eventId, orgId: org.id },
  });
  if (!event) throw new Error("Event not found.");

  const now = new Date();
  await db.order.create({
    data: {
      orgId: org.id,
      eventId: event.id,
      status: "CONFIRMED",
      method: "COMP",
      registrantName: "Membership comp",
      registrantEmail: "comp@gate.local",
      registrantPhone: "",
      attendees: {
        create: Array.from({ length: n }, () => ({
          orgId: org.id,
          eventId: event.id,
          checkedInAt: now,
        })),
      },
    },
  });
  void userId; // reserved for attribution once gate audit logging lands
}

/**
 * Create a PENDING gate sale. Walk-up (no `attendeeId`) creates a new attendee
 * for admission; buy-more (an `attendeeId`) attaches merch to an already-resolved
 * person. Caller then settles via `confirmGateCash` (or a Stripe checkout).
 * Prices come from the server-side ServiceType menu, never the client.
 */
export async function sellAtGate(
  eventId: string,
  serviceTypeIds: string[],
  opts: { buyerName?: string; attendeeId?: string } = {},
): Promise<{ orderId: string; totalCents: number }> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  if (serviceTypeIds.length === 0) throw new Error("Pick at least one item.");

  const event = await db.event.findFirst({
    where: { id: eventId, orgId: org.id },
  });
  if (!event) throw new Error("Event not found.");

  // Resolve via this event's offerings so the gate charges the per-event price.
  const offerings = await db.serviceCap.findMany({
    where: {
      eventId: event.id,
      serviceTypeId: { in: serviceTypeIds },
      serviceType: { orgId: org.id, active: true },
    },
    include: { serviceType: true },
  });
  const byId = new Map(offerings.map((o) => [o.serviceTypeId, o]));
  for (const id of serviceTypeIds) {
    if (!byId.has(id)) throw new Error("Item not offered at this event.");
  }

  const name = opts.buyerName?.trim() || "Gate sale";
  const needsAttendee = !opts.attendeeId;

  const order = await db.order.create({
    data: {
      orgId: org.id,
      eventId: event.id,
      status: "PENDING",
      method: "CASH",
      registrantName: name,
      registrantEmail: "gate@gate.local",
      registrantPhone: "",
      attendees: needsAttendee
        ? { create: [{ orgId: org.id, eventId: event.id, name }] }
        : undefined,
    },
    include: { attendees: true },
  });

  const attendeeId = opts.attendeeId ?? order.attendees[0].id;

  // Walk-ups pay the door price; a pre-bought will-call order settled here keeps
  // its original online price, because that path confirms existing lines and
  // never routes through this function.
  const now = new Date();
  const doorCents = (o: (typeof offerings)[number]) =>
    resolvePrice(o, "door", now).amountCents;

  await db.lineItem.createMany({
    data: serviceTypeIds.map((id) => {
      const offering = byId.get(id)!;
      return {
        orgId: org.id,
        orderId: order.id,
        attendeeId,
        serviceTypeId: offering.serviceTypeId,
        description: `${offering.serviceType.name} — ${name}`,
        amountCents: doorCents(offering),
        status: "PENDING_PAYMENT" as const,
      };
    }),
  });

  const totalCents = serviceTypeIds.reduce((s, id) => {
    const offering = byId.get(id);
    return s + (offering ? doorCents(offering) : 0);
  }, 0);
  return { orderId: order.id, totalCents };
}

/**
 * Record cash for a gate order and confirm it via the single PaymentService
 * (idempotent). Confirmation assigns campIds, marks the order + line items paid,
 * and writes the ledger entry. GENERAL events have no stations, so no route is
 * built. Returns the new attendee ids (for a walk-up admission).
 */
export async function confirmGateCash(
  orderId: string,
  tenderedCents?: number,
): Promise<{ attendeeIds: string[] }> {
  await confirmOrderPaid(orderId, {
    method: "CASH",
    idempotencyKey: `gate-cash-${orderId}`,
    cashTenderedCents: tenderedCents,
  });
  const attendees = await db.attendee.findMany({
    where: { orderId },
    select: { id: true },
  });
  return { attendeeIds: attendees.map((a) => a.id) };
}

/** Cumulative total admitted at this event (drives the gate headcount). */
export async function getEventHeadcount(eventId: string): Promise<number> {
  const org = await getActiveOrg();
  if (!org) return 0;
  return db.attendee.count({
    where: { orgId: org.id, eventId, checkedInAt: { not: null } },
  });
}

/**
 * The sellable gate catalogue for one event, split into admission vs merch.
 * Scoped to services actually offered at this event (those with a ServiceCap
 * row) so a camp's clinical services never leak into a dance-night gate.
 */
export async function getGateCatalog(eventId: string): Promise<{
  admission: { id: string; name: string; priceCents: number }[];
  merch: { id: string; name: string; priceCents: number; colorHex: string }[];
  fees: { id: string; name: string; priceCents: number }[];
}> {
  const org = await getActiveOrg();
  if (!org) return { admission: [], merch: [], fees: [] };
  // Per-event offerings (caps), priced from the cap not the catalogue.
  const offerings = await db.serviceCap.findMany({
    where: { eventId, serviceType: { orgId: org.id, active: true } },
    include: { serviceType: true },
    orderBy: { serviceType: { name: "asc" } },
  });
  // The gate menu shows DOOR prices — $20 walk-up where online was $15.
  const now = new Date();
  const doorCents = (o: (typeof offerings)[number]) =>
    resolvePrice(o, "door", now).amountCents;
  return {
    admission: offerings
      .filter((o) => o.serviceType.kind === "ADMISSION" && !o.serviceType.hasLab)
      .map((o) => ({ id: o.serviceType.id, name: o.serviceType.name, priceCents: doorCents(o) })),
    merch: offerings
      .filter((o) => o.serviceType.kind === "MERCH")
      .map((o) => ({
        id: o.serviceType.id,
        name: o.serviceType.name,
        priceCents: doorCents(o),
        colorHex: o.serviceType.colorHex,
      })),
    // A competition entry sold at the desk. Buying one admits nobody and hands
    // over nothing.
    fees: offerings
      .filter((o) => o.serviceType.kind === "FEE" && !o.serviceType.hasLab)
      .map((o) => ({ id: o.serviceType.id, name: o.serviceType.name, priceCents: doorCents(o) })),
  };
}
