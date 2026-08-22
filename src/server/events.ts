import type { Event, EventType } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Which event is happening right now.
 *
 * Replaces getActiveCamp (src/server/stations.ts), which was:
 *
 *   findFirst({ orgId, type: "CAMP", status: "ACTIVE" })
 *     ?? findFirst({ orgId, type: "CAMP", status: "OPEN" })
 *
 * and had three defects, all observed on test:
 *
 *   1. NO DATE BOUND. `status` is hand-set and drifts, so a camp scheduled for
 *      June 2027 was presented as "happening now" in August 2026 — and a general
 *      event that ended 160 days earlier was still ACTIVE at the same time.
 *   2. NO ORDER. `findFirst` without `orderBy` returns whichever row Postgres
 *      hands back, so with two ACTIVE events the answer was arbitrary.
 *   3. THE `?? OPEN` FALLBACK presented an event a year out, with live queue
 *      depths and payment totals, as though it were running. An event that is
 *      merely selling is not an event that is happening.
 *
 * The `type` filter was NOT purely a defect and is kept as an option: stations
 * exist only on camps, so the station screens legitimately scope to CAMP (the
 * original comment: "so a concurrently-ACTIVE general event never shadows the
 * medcamp"). The dashboard passes no type, because a dandiya night is as real
 * an event as a camp and could never appear before.
 *
 * RETURNING NULL IS A CORRECT ANSWER. Most of the year nothing is running, and
 * callers must render that rather than reach for something to show — preferring
 * a stale fixture over "nothing is running" is what produced the original bug.
 */
export async function getCurrentEvent(
  orgId: string,
  opts?: { type?: EventType; now?: Date },
): Promise<Event | null> {
  const now = opts?.now ?? new Date();
  const type = opts?.type;

  // 1. ACTIVE and genuinely happening: now falls inside the event's window.
  const inWindow = await db.event.findFirst({
    where: {
      orgId,
      ...(type ? { type } : {}),
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    orderBy: { startsAt: "asc" },
  });
  if (inWindow) return inWindow;

  // 2. ACTIVE, already started, with a door a coordinator deliberately opened.
  //    This outranks a scheduled END time on purpose — the same ruling
  //    isRegistrationOpen already encodes (src/server/registration.ts): a camp
  //    booked 8am-1pm that runs to 2:30pm is routine, and the staff working it
  //    still need the dashboard and their station queues.
  //
  //    `startsAt <= now` IS REQUIRED, not decoration. The exception is about
  //    running past the end, never about starting early. Without it, the test
  //    fixture MC-2027S — ACTIVE, walk-in flag set, scheduled for June 2027 —
  //    matches today and the dashboard shows a camp ten months out as live,
  //    which is the original bug wearing a new hat.
  const ranLong = await db.event.findFirst({
    where: {
      orgId,
      ...(type ? { type } : {}),
      status: "ACTIVE",
      startsAt: { lte: now },
      walkInOpensAt: { not: null },
    },
    orderBy: { startsAt: "asc" },
  });
  if (ranLong) return ranLong;

  // 3. Nothing is running. Say so.
  return null;
}

export type TrackedEvent = {
  id: string;
  code: string;
  name: string;
  status: string;
  startsAt: Date;
  /** Negative when the event has already finished. */
  daysUntil: number;
  /** Finished, but still OPEN or ACTIVE — someone needs to close it. */
  isStale: boolean;
  sold: number;
  capacity: number;
  revenueCents: number;
  earlyBirdEndsAt: Date | null;
};

/**
 * Events being tracked but not running: selling now, or finished and never
 * closed.
 *
 * WHY THIS EXISTS. getCurrentEvent correctly returns null most of the year, and
 * the dashboard's answer to that was the single line "No active camp." — a dead
 * end on the most common state. Meanwhile real activity had nowhere to appear:
 * measured on test, Garba was 25/40 sold with $238.50 collected, Rhythms of
 * Navratri had 8 registrations with its early bird closing in 10 days, and a
 * general event that ended 160 days earlier was still ACTIVE holding $541.
 * None of it was visible anywhere in the console.
 *
 * This is the minimum honest answer to "nothing is running, so what IS
 * happening". The full readiness board (flags, per-event checklists, the sales
 * view) builds on this shape rather than replacing it — see
 * docs/superpowers/specs/2026-08-21-backoffice-foundations-design.md, Part 4.
 */
export async function getTrackedEvents(
  orgId: string,
  now: Date = new Date(),
): Promise<TrackedEvent[]> {
  const events = await db.event.findMany({
    where: { orgId, status: { in: ["OPEN", "ACTIVE"] } },
    orderBy: { startsAt: "asc" },
    include: {
      caps: {
        where: { serviceType: { active: true } },
        select: { sold: true, capacity: true, earlyBirdUntil: true },
      },
    },
  });
  if (events.length === 0) return [];

  // Revenue in ONE query, read through orders rather than grouping payments by
  // orderId — Payment.orderId is nullable, so grouping on it yields a key that
  // cannot be mapped back to an event.
  const paidOrders = await db.order.findMany({
    where: { eventId: { in: events.map((e) => e.id) } },
    select: {
      eventId: true,
      payments: { where: { status: "SUCCEEDED" }, select: { amountCents: true } },
    },
  });
  const revenueByEvent = new Map<string, number>();
  for (const o of paidOrders) {
    const sum = o.payments.reduce((n, p) => n + p.amountCents, 0);
    if (sum === 0) continue;
    revenueByEvent.set(o.eventId, (revenueByEvent.get(o.eventId) ?? 0) + sum);
  }

  const DAY = 86_400_000;
  const rows = events.map((e) => {
    const deadlines = e.caps
      .map((c) => c.earlyBirdUntil)
      .filter((d): d is Date => d !== null && d > now)
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      status: e.status,
      startsAt: e.startsAt,
      daysUntil: Math.round((e.startsAt.getTime() - now.getTime()) / DAY),
      // The signal that produces the Close action. Status is hand-set and
      // drifts; this is the system noticing rather than waiting to be told.
      isStale: e.endsAt < now,
      sold: e.caps.reduce((n, c) => n + c.sold, 0),
      capacity: e.caps.reduce((n, c) => n + c.capacity, 0),
      revenueCents: revenueByEvent.get(e.id) ?? 0,
      earlyBirdEndsAt: deadlines[0] ?? null,
    };
  });

  // Work first, then what's coming. Stale events need a decision from a human;
  // upcoming ones are context. Sorting purely by date happens to put the oldest
  // stale event on top today, but only by coincidence — an event that finished
  // yesterday would otherwise sink below everything scheduled for next year.
  return rows.sort((a, b) => {
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    return a.daysUntil - b.daysUntil;
  });
}
