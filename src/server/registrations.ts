/**
 * What an event has actually SOLD, readable at any point in its life.
 *
 * WHY THIS EXISTS. Every money figure in the console was gated on
 * `getCurrentEvent` — which by design returns null unless an event is ACTIVE
 * *and* the clock is inside its window (src/server/events.ts). So for the ~360
 * days a year an event is not physically running, `/dashboard` fell through to
 * a one-line summary and `/api/reports/reconciliation` answered 404. An event
 * that had been selling tickets for a month had no screen that would tell you
 * how much money had come in, or from whom.
 *
 * This is event-scoped instead of "now"-scoped: you pass the event id, so a
 * coordinator can read a camp three weeks out, one that finished in March, and
 * one running this second through the same screen.
 *
 * PAID MEANS `campId != null`, NOT `Attendee` ROW COUNT. campIds are assigned
 * inside confirmOrderPaid's transaction (src/server/payments.ts) and nowhere
 * else, so the field is the one durable marker that money changed hands —
 * across online checkout, gate cash, and comped $0 orders alike. Counting raw
 * Attendee rows instead (which is what /admin/camps/[id] used to print) is
 * wrong twice over: rows are created at CART creation on a PENDING order and
 * nothing ever reaps them, and in quantity mode one "family of 4" purchase
 * mints four of them. This matches the definition `/dashboard` already uses, so
 * the two screens can no longer disagree about the word "registered".
 */

import { db } from "@/lib/db";

/** One confirmed order, as a line in the detail list. */
export type PaidOrderRow = {
  id: string;
  registrantName: string;
  registrantEmail: string;
  createdAt: Date;
  /** Money actually collected against this order. Zero for a fully comped one. */
  collectedCents: number;
  /** How it was settled. Null when nothing was ever charged (a $0 order). */
  method: string | null;
  /** Confirmation codes minted by this order — one per admitted head. */
  campIds: string[];
  items: { description: string; quantity: number; amountCents: number }[];
};

/** One of the event's offerings, with what it took. */
export type OfferingSale = {
  name: string;
  kind: string;
  /** ServiceCap.sold — units, incremented only at confirmation. */
  sold: number;
  /** Null = uncapped. "25 sold of unlimited" is not a sentence. */
  capacity: number | null;
  revenueCents: number;
};

export type EventRegistrations = {
  /** Attendees holding a campId. THE number behind "N registered". */
  paidAttendees: number;
  paidOrders: number;
  collectedCents: number;
  byMethod: { method: string; cents: number; count: number }[];
  /**
   * Carts that reached checkout and never paid, and what they would have been
   * worth. Printed because it is the difference between this screen's count and
   * the raw row count, and a coordinator who remembers the old number deserves
   * to see where it went rather than assume registrations were lost.
   */
  unpaidOrders: number;
  unpaidCents: number;
  offerings: OfferingSale[];
  /** Broken out for reconciliation, the way LineItem flags them. */
  donationCents: number;
  membershipCents: number;
  orders: PaidOrderRow[];
};

export async function getEventRegistrations(
  orgId: string,
  eventId: string,
): Promise<EventRegistrations> {
  // ONE read of the event's orders with everything hanging off them, rather
  // than a query per figure. An event's whole order book is small (a 500-patient
  // camp is the ceiling) and this page is force-dynamic, so the alternative —
  // five aggregate queries that can disagree with the list below them — buys
  // nothing.
  const [orders, caps] = await Promise.all([
    db.order.findMany({
      where: { orgId, eventId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        registrantName: true,
        registrantEmail: true,
        createdAt: true,
        attendees: { select: { campId: true } },
        lineItems: {
          select: {
            description: true,
            quantity: true,
            amountCents: true,
            status: true,
            serviceTypeId: true,
            isDonation: true,
            membershipPlanId: true,
          },
        },
        payments: {
          select: { method: true, status: true, amountCents: true },
        },
      },
    }),
    db.serviceCap.findMany({
      where: { eventId, serviceType: { orgId } },
      orderBy: { serviceType: { name: "asc" } },
      select: {
        serviceTypeId: true,
        capacity: true,
        sold: true,
        serviceType: { select: { name: true, kind: true } },
      },
    }),
  ]);

  const byMethodMap = new Map<string, { cents: number; count: number }>();
  const revenueByService = new Map<string, number>();
  const paid: PaidOrderRow[] = [];

  let paidAttendees = 0;
  let collectedCents = 0;
  let unpaidOrders = 0;
  let unpaidCents = 0;
  let donationCents = 0;
  let membershipCents = 0;

  for (const o of orders) {
    const campIds = o.attendees
      .map((a) => a.campId)
      .filter((c): c is string => c !== null);
    paidAttendees += campIds.length;

    // SUCCEEDED only. A PENDING Payment row is a Stripe session that was opened,
    // which is not money — that conflation is the whole reason the raw counts
    // were wrong.
    const succeeded = o.payments.filter((p) => p.status === "SUCCEEDED");
    const orderCollected = succeeded.reduce((n, p) => n + p.amountCents, 0);
    collectedCents += orderCollected;
    for (const p of succeeded) {
      const m = byMethodMap.get(p.method) ?? { cents: 0, count: 0 };
      m.cents += p.amountCents;
      m.count++;
      byMethodMap.set(p.method, m);
    }

    // Line totals are amountCents × quantity — a five-stick line is one row.
    for (const li of o.lineItems) {
      const total = li.amountCents * li.quantity;
      if (li.status !== "PAID") continue;
      if (li.isDonation) donationCents += total;
      else if (li.membershipPlanId) membershipCents += total;
      else if (li.serviceTypeId) {
        revenueByService.set(
          li.serviceTypeId,
          (revenueByService.get(li.serviceTypeId) ?? 0) + total,
        );
      }
    }

    if (o.status === "CONFIRMED") {
      paid.push({
        id: o.id,
        registrantName: o.registrantName,
        registrantEmail: o.registrantEmail,
        createdAt: o.createdAt,
        collectedCents: orderCollected,
        method: succeeded[0]?.method ?? null,
        campIds,
        items: o.lineItems
          .filter((li) => li.status === "PAID")
          .map((li) => ({
            description: li.description,
            quantity: li.quantity,
            amountCents: li.amountCents,
          })),
      });
    } else if (o.status === "PENDING") {
      unpaidOrders++;
      unpaidCents += o.lineItems.reduce(
        (n, li) => n + li.amountCents * li.quantity,
        0,
      );
    }
    // CANCELLED is deliberately not counted anywhere: the reaper already
    // retired it and nobody is waiting on it.
  }

  return {
    paidAttendees,
    paidOrders: paid.length,
    collectedCents,
    byMethod: [...byMethodMap.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.cents - a.cents),
    unpaidOrders,
    unpaidCents,
    offerings: caps.map((c) => ({
      name: c.serviceType.name,
      kind: c.serviceType.kind,
      sold: c.sold,
      capacity: c.capacity,
      revenueCents: revenueByService.get(c.serviceTypeId) ?? 0,
    })),
    donationCents,
    membershipCents,
    orders: paid,
  };
}
