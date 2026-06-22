import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { getActiveCamp } from "@/server/stations";

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
  const camp = await getActiveCamp(org.id);
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

/** Rows for the reconciliation CSV export (camp-scoped payments). */
export async function getReconciliationRows() {
  const org = await getActiveOrg();
  if (!org) return { campCode: null, rows: [] as ReconRow[] };
  const camp = await getActiveCamp(org.id);
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
