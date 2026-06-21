import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { parseCampId } from "@/lib/campId";
import { confirmOrderPaid } from "@/server/payments";

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
  /** Pre-bought physical goods to hand over (fulfillable line items). */
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

/** Resolve a scanned/typed code to a gate view within the active org. */
export async function getGateView(rawCode: string): Promise<GateView | null> {
  const org = await getActiveOrg();
  if (!org) return null;

  const parsed = parseCampId(rawCode);
  const campId = parsed
    ? `${parsed.eventCode}-${parsed.sequence.toString().padStart(4, "0")}`
    : rawCode.trim().toUpperCase();

  const attendee = await db.attendee.findFirst({
    where: { orgId: org.id, campId },
    include: {
      event: true,
      order: { include: { lineItems: true } },
      lineItems: { include: { serviceType: true } },
    },
  });
  if (!attendee) return null;

  const amountOwedCents = attendee.order.lineItems
    .filter((li) => li.status === "PENDING_PAYMENT")
    .reduce((s, li) => s + li.amountCents, 0);

  const pickupItems = attendee.lineItems
    .filter((li) => li.serviceType?.fulfillable)
    .map((li) => ({
      lineItemId: li.id,
      name: li.serviceType?.name ?? li.description,
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

/** Admit a paid attendee. Idempotent — a re-scan is a no-op (wristband owns re-entry). */
export async function admitAttendee(attendeeId: string): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const attendee = await db.attendee.findFirst({
    where: { id: attendeeId, orgId: org.id },
    include: { order: true },
  });
  if (!attendee) throw new Error("Attendee not found.");
  if (attendee.checkedInAt) return; // already processed
  if (attendee.order.status !== "CONFIRMED") {
    throw new Error("Not paid — take payment before admitting.");
  }
  await db.attendee.update({
    where: { id: attendee.id },
    data: { checkedInAt: new Date() },
  });
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

/** Hand over every fulfillable item on an order (used right after a gate merch sale). */
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
    items.filter((i) => i.serviceType?.fulfillable).map((i) => i.id),
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

  const services = await db.serviceType.findMany({
    where: { id: { in: serviceTypeIds }, orgId: org.id, active: true },
  });
  const byId = new Map(services.map((s) => [s.id, s]));
  for (const id of serviceTypeIds) {
    if (!byId.has(id)) throw new Error("Unknown or inactive item.");
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

  await db.lineItem.createMany({
    data: serviceTypeIds.map((id) => {
      const st = byId.get(id)!;
      return {
        orgId: org.id,
        orderId: order.id,
        attendeeId,
        serviceTypeId: st.id,
        description: `${st.name} — ${name}`,
        amountCents: st.priceCents,
        status: "PENDING_PAYMENT" as const,
      };
    }),
  });

  const totalCents = serviceTypeIds.reduce(
    (s, id) => s + (byId.get(id)?.priceCents ?? 0),
    0,
  );
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
}> {
  const org = await getActiveOrg();
  if (!org) return { admission: [], merch: [] };
  const services = await db.serviceType.findMany({
    where: {
      orgId: org.id,
      active: true,
      caps: { some: { eventId } },
    },
    orderBy: { name: "asc" },
  });
  return {
    admission: services
      .filter((s) => !s.fulfillable && !s.hasLab)
      .map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents })),
    merch: services
      .filter((s) => s.fulfillable)
      .map((s) => ({
        id: s.id,
        name: s.name,
        priceCents: s.priceCents,
        colorHex: s.colorHex,
      })),
  };
}
