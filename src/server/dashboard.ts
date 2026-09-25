import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentEvent } from "@/server/events";
import { venueDayKey } from "@/lib/eventTime";

/**
 * Coordinator dashboard data (Module 4). One read of the active camp's checked-in
 * attendees drives queue depths + flow stats; payments are summarized from the
 * single ledger/payments table. All org + camp scoped. Refreshed by polling for
 * now (Supabase Realtime is the planned upgrade — its anon channel needs RLS
 * policies, deferred under Approach C).
 */

const BOTTLENECK_THRESHOLD = 8; // waiting count that flags a station

export type DashboardData = {
  campName: string;
  campStatus: string;
  walkInOpen: boolean;
  stats: {
    registered: number;
    checkedIn: number;
    inFlight: number;
    completed: number;
    needsPayment: number;
  };
  stations: {
    key: string;
    name: string;
    colorHex: string | null;
    waiting: number;
    inProgress: number;
    bottleneck: boolean;
  }[];
  payments: {
    collectedCents: number;
    byMethod: { method: string; cents: number; count: number }[];
    pendingAddonCents: number;
    pendingAddonCount: number;
  };
} | null;

export async function getDashboard(): Promise<DashboardData> {
  const org = await getActiveOrg();
  if (!org) return null;
  // NO TYPE FILTER, unlike the station screens. This used getActiveCamp, which
  // scoped to type CAMP — so Garba, Rhythms of Navratri, Dandiya Night and the
  // Diwali festival could NEVER appear on the coordinator dashboard. On event
  // night there was no dashboard at all. A general event has no stations, so the
  // queue section renders empty for one; the headcount and payment figures are
  // the point there, and they were previously unreachable.
  const camp = await getCurrentEvent(org.id);
  if (!camp) return null;

  const stations = await db.station.findMany({
    where: { eventId: camp.id, active: true },
    orderBy: { sequence: "asc" },
  });

  const checkedInAttendees = await db.attendee.findMany({
    where: { eventId: camp.id, checkedInAt: { not: null } },
    include: { stationVisits: true },
  });

  // Queue depths via current-station routing (matches Module 3 engine).
  const depth = new Map<string, { waiting: number; inProgress: number }>();
  let completed = 0;
  for (const a of checkedInAttendees) {
    const nonDone = a.stationVisits
      .filter((v) => v.status !== "DONE")
      .sort((x, y) => x.sequence - y.sequence);
    if (nonDone.length === 0) {
      completed++;
      continue;
    }
    const current = nonDone[0];
    const d = depth.get(current.stationId) ?? { waiting: 0, inProgress: 0 };
    if (current.status === "IN_PROGRESS") d.inProgress++;
    else d.waiting++;
    depth.set(current.stationId, d);
  }

  const [registered, needsPayment] = await Promise.all([
    db.attendee.count({ where: { eventId: camp.id, campId: { not: null } } }),
    db.attendee.count({
      where: {
        eventId: camp.id,
        lineItems: { some: { addedOnsite: true, status: "PENDING_PAYMENT" } },
      },
    }),
  ]);
  const checkedIn = checkedInAttendees.length;

  // Payments for this camp (scoped via order.eventId).
  const payments = await db.payment.findMany({
    where: { order: { eventId: camp.id }, status: "SUCCEEDED" },
    select: { method: true, amountCents: true },
  });
  const byMethodMap = new Map<string, { cents: number; count: number }>();
  let collectedCents = 0;
  for (const p of payments) {
    collectedCents += p.amountCents;
    const m = byMethodMap.get(p.method) ?? { cents: 0, count: 0 };
    m.cents += p.amountCents;
    m.count++;
    byMethodMap.set(p.method, m);
  }

  // Quantity-aware sum (a line's total is amountCents × quantity).
  const pendingAddonItems = await db.lineItem.findMany({
    where: {
      attendee: { eventId: camp.id },
      addedOnsite: true,
      status: "PENDING_PAYMENT",
    },
    select: { amountCents: true, quantity: true },
  });
  const pendingAddon = {
    _sum: {
      amountCents: pendingAddonItems.reduce(
        (s, li) => s + li.amountCents * li.quantity,
        0,
      ),
    },
    _count: pendingAddonItems.length,
  };

  return {
    campName: camp.name,
    campStatus: camp.status,
    walkInOpen: Boolean(camp.walkInOpensAt),
    stats: {
      registered,
      checkedIn,
      inFlight: checkedIn - completed,
      completed,
      needsPayment,
    },
    stations: stations.map((s) => {
      const d = depth.get(s.id) ?? { waiting: 0, inProgress: 0 };
      return {
        key: s.key,
        name: s.name,
        colorHex: s.colorHex,
        waiting: d.waiting,
        inProgress: d.inProgress,
        bottleneck: d.waiting >= BOTTLENECK_THRESHOLD,
      };
    }),
    payments: {
      collectedCents,
      byMethod: [...byMethodMap.entries()].map(([method, v]) => ({
        method,
        cents: v.cents,
        count: v.count,
      })),
      pendingAddonCents: pendingAddon._sum.amountCents ?? 0,
      pendingAddonCount: pendingAddon._count,
    },
  };
}

/**
 * Rows for the reconciliation CSV export (event-scoped payments). Matches the
 * dashboard's event exactly — the treasurer's export must be for the event on
 * screen, so both resolve through getCurrentEvent with no type filter.
 */
/** One day's takings, bucketed on the VENUE's calendar. */
export type DailySalesDay = {
  /** `YYYY-MM-DD` at the venue. */
  day: string;
  /** Units purchased that day. Donations are money, not units, so excluded. */
  units: number;
  /** Money that actually arrived, integer cents. */
  cents: number;
};

/** How many days the dashboard chart covers. */
export const DAILY_SALES_DAYS = 14;

/**
 * Purchases per day — units and money — for the sales chart.
 *
 * TWO DEFINITIONS, BOTH ALREADY SETTLED IN THIS REPO, and neither re-invented
 * here (scripts/verify-registrations.ts pins both):
 *
 *   MONEY is SUCCEEDED payments. A PENDING Payment row is a Stripe session
 *   somebody opened; counting it is the same class of mistake as counting an
 *   abandoned cart, and it is the defect that suite exists for.
 *
 *   A LINE TOTAL is amountCents x quantity. A five-stick line is ONE row worth
 *   five units, so summing rows instead of quantities under-reports merch.
 *
 * UNITS EXCLUDE DONATIONS. A $50 donation is money but not a thing anyone
 * bought, and folding it in would make the unit bar move for a gift. Membership
 * IS a unit — somebody bought a membership.
 *
 * BUCKETED BY PAYMENT DATE, ON THE VENUE'S CALENDAR. When the money arrived is
 * what "purchases on that day" means; an order's createdAt is when a cart was
 * opened, which can be a different day entirely. Venue rather than UTC because
 * a 7pm sale in Flower Mound is already tomorrow in UTC, and the busy hours of
 * an event evening are exactly the ones a UTC key would move onto the next bar.
 *
 * An order's UNITS are attributed to its FIRST succeeded payment's day, so a
 * split payment cannot count the same tickets twice; its MONEY is attributed
 * per payment, so each day shows what actually landed. Both totals therefore
 * reconcile with the registrations page.
 */
export async function getDailySales(
  orgId: string,
  days: number = DAILY_SALES_DAYS,
  now: Date = new Date(),
): Promise<DailySalesDay[]> {
  // Reach back an extra day: "14 venue days ago" starts earlier in UTC than
  // "14 x 24h ago" whenever the venue is behind Greenwich, and a short window
  // would silently clip the oldest bar.
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);

  const payments = await db.payment.findMany({
    where: {
      status: "SUCCEEDED",
      createdAt: { gte: since },
      order: { orgId },
    },
    include: { order: { include: { lineItems: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Every day in range, including the empty ones. A chart that silently drops
  // quiet days compresses the axis and makes a gap look like activity.
  const buckets = new Map<string, DailySalesDay>();
  for (let i = days - 1; i >= 0; i--) {
    const key = venueDayKey(new Date(now.getTime() - i * 86_400_000));
    buckets.set(key, { day: key, units: 0, cents: 0 });
  }

  const countedOrders = new Set<string>();
  for (const p of payments) {
    // orderId is nullable with onDelete: SetNull, so a payment can outlive the
    // order it settled. The money is still real and still counts; there are
    // simply no lines left to count units from.
    const order = p.order;
    const key = venueDayKey(p.createdAt);
    const bucket = buckets.get(key);
    // Older than the window once bucketed on the venue's calendar.
    if (!bucket) continue;

    bucket.cents += p.amountCents;

    // Units once per order, on the day its first payment succeeded.
    if (!order || countedOrders.has(order.id)) continue;
    countedOrders.add(order.id);
    for (const li of order.lineItems) {
      if (li.status !== "PAID") continue;
      if (li.isDonation) continue;
      bucket.units += li.quantity;
    }
  }

  return [...buckets.values()];
}

export async function getReconciliationRows() {
  const org = await getActiveOrg();
  if (!org) return { campCode: null, rows: [] as ReconRow[] };
  const camp = await getCurrentEvent(org.id);
  if (!camp) return { campCode: null, rows: [] as ReconRow[] };

  const payments = await db.payment.findMany({
    where: { order: { eventId: camp.id } },
    include: { order: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    campCode: camp.code,
    rows: payments.map((p) => ({
      paymentId: p.id,
      createdAt: p.createdAt.toISOString(),
      method: p.method,
      status: p.status,
      amountCents: p.amountCents,
      orderId: p.orderId ?? "",
      registrantEmail: p.order?.registrantEmail ?? "",
      stripePaymentIntentId: p.stripePaymentIntentId ?? "",
    })),
  };
}

export type ReconRow = {
  paymentId: string;
  createdAt: string;
  method: string;
  status: string;
  amountCents: number;
  orderId: string;
  registrantEmail: string;
  stripePaymentIntentId: string;
};
