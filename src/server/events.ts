import type { EventStatus, EventType } from "@prisma/client";
import { db, type EventRecord } from "@/lib/db";
import { venueDaysUntil } from "@/lib/eventTime";

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
): Promise<EventRecord | null> {
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
      // Uncapped services contribute nothing to a total — "25 sold of 40" is
      // meaningful, "25 sold of unlimited" is not, so the UI shows the bare
      // count when this is 0.
      capacity: e.caps.reduce((n, c) => n + (c.capacity ?? 0), 0),
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

/* ========================================================================== *
 * Setup readiness
 * ========================================================================== */

/** The five checks, in the order a coordinator actually does them. */
export type ReadinessKey =
  | "services"
  | "stations"
  | "registration"
  | "volunteers"
  | "flags";

export type ReadinessItem = {
  key: ReadinessKey;
  /** The row's own words, with this event's real numbers already in them. */
  label: string;
  done: boolean;
  /**
   * What goes wrong while this is unmet, in plain words, with the clock in it.
   * Present only when `done` is false — a satisfied row has no consequence to
   * state and a checklist that explains its ticks is a checklist nobody reads.
   */
  consequence?: string;
  /** Imperative, and the label of the card's primary button when this is first. */
  action: string;
  /** Where the fix is made. */
  href: string;
  /**
   * True when this gap is one a MEMBER OF THE PUBLIC hits right now — today,
   * without waiting for event day.
   *
   * WHY THE DISTINCTION EARNS ITS KEEP. Every unmet row is a blocker, but they
   * are not the same kind of problem, and a list that paints all of them the
   * same red is a list that gets ignored. "Volunteer roles unfilled" with seven
   * weeks left is work still on the clock. "Publicly OPEN with nothing priced"
   * is a guest tapping Register today and reaching an empty form — measured on
   * the dev database, DCICA Festival of Lights is in exactly that state. The
   * overview reserves its red tint for this flag so the second case cannot hide
   * among five instances of the first.
   */
  brokenInPublic: boolean;
};

export type EventReadiness = {
  id: string;
  code: string;
  name: string;
  type: EventType;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  /** Venue calendar days until the event starts; negative once it is past. */
  daysUntil: number;
  /** The scheduled finish is behind us. Independent of the hand-set `status`. */
  hasFinished: boolean;
  registered: number;
  /** Flow order. Length is 5 for a camp, 4 for everything else — see below. */
  items: ReadinessItem[];
  done: number;
  total: number;
  blockers: number;
  /** First unmet item in FLOW ORDER. This is what owns the card's one action. */
  firstBlocker: ReadinessItem | null;
};

/**
 * Is this event set up, and if not, what is the one thing to do about it.
 *
 * WHY THIS EXISTS. /admin printed `0 services · 0 stations · 0 registered` in
 * 12px grey and called it a status line. Measured on the dev database, that
 * rendered "0 services" for DCICA Festival of Lights — an event that is
 * publicly OPEN and cannot sell anything — in exactly the same weight as
 * "4 services" for the event next to it. A count is not a verdict. The
 * coordinator was being handed the raw material for a judgement and asked to
 * make it themselves, six times, on a phone.
 *
 * FLOW ORDER IS LOAD-BEARING, not cosmetic. The rows are listed in the order
 * the work is actually done, and the FIRST unmet one owns the card's single
 * action, because fixing a later step first is usually wasted: assigning
 * volunteers to stations that do not exist yet, or opening registration for a
 * service menu with no prices in it. One action, pointed at the earliest thing
 * that is wrong.
 *
 * THE ROW SET DEPENDS ON EventType. A GENERAL event — a dandiya night, a garba
 * class — has no stations and never will; patient routing is a camp concept.
 * Scoring one 4-out-of-5 forever, with a blocker nobody can ever clear, is how
 * you teach a coordinator that the card is decoration. Every event is therefore
 * scored out of the rows that can apply to it: 5 for a CAMP, 4 for anything
 * else. MEMBERSHIP_DRIVE has no stations either and falls out of the same test.
 *
 * WHAT IS DELIBERATELY *NOT* A BLOCKER:
 *   - Zero registrations on a freshly opened event. That is what day one looks
 *     like. Flagging it would put a permanent blocker on every event between
 *     opening and the first sale.
 *   - A partly-filled volunteer roster. 14 of 33 with seven weeks to go is a
 *     roster in progress. The zero that matters is a NAMED ROLE WITH NOBODY IN
 *     IT — that is the one that leaves a station unstaffed on the day, and it
 *     is what frame 1B's "No volunteers assigned to Vitals or Labs" is pointing
 *     at. The shortfall is still stated on the row either way.
 *   - CLOSED / PURGED registration. Registration being shut on a finished event
 *     is the correct end state, not an unfinished step.
 *
 * TWO QUERIES, whatever the event count — the same N+1 avoidance getTrackedEvents
 * uses next door. Volunteer fill needs a per-ROLE non-cancelled signup count
 * (see above), which no `_count` on the event can give, so it is one extra
 * `IN (...)` fetch rather than one query per event.
 *
 * Sorted soonest-first, with finished events last: see `bySoonest`.
 */
export async function getEventReadiness(
  orgId: string,
  opts?: { eventId?: string; now?: Date },
): Promise<EventReadiness[]> {
  const now = opts?.now ?? new Date();

  const events = await db.event.findMany({
    where: { orgId, ...(opts?.eventId ? { id: opts.eventId } : {}) },
    include: { _count: { select: { caps: true, stations: true, attendees: true } } },
  });
  if (events.length === 0) return [];

  // Non-cancelled signups counted PER ROLE, not per event. A per-event total
  // cannot answer "which role has nobody in it", and that is the question the
  // volunteer row is asking. CANCELLED is excluded because a withdrawn
  // volunteer is not a volunteer; every other status — waitlisted, no-show,
  // checked out — is someone who committed.
  const roles = await db.volunteerRole.findMany({
    where: { eventId: { in: events.map((e) => e.id) }, active: true },
    select: {
      eventId: true,
      name: true,
      capacity: true,
      _count: { select: { signups: { where: { status: { not: "CANCELLED" } } } } },
    },
    orderBy: { name: "asc" },
  });
  const rolesByEvent = new Map<string, typeof roles>();
  for (const role of roles) {
    const list = rolesByEvent.get(role.eventId) ?? [];
    list.push(role);
    rolesByEvent.set(role.eventId, list);
  }

  return events
    .map((e) => score(e, rolesByEvent.get(e.id) ?? [], now))
    .sort(bySoonest);
}

/**
 * Soonest first — the defect this replaces.
 *
 * /admin sorted `startsAt: "desc"`, which is newest-first, which on a console
 * whose whole job is "what needs doing next" is backwards. Measured on the dev
 * database it opened on a June 2027 test fixture and pushed Rhythm of Navratri,
 * seven weeks out and real, to fourth.
 *
 * Finished events sink below everything still ahead, most recent first. This is
 * NOT the same ruling as getTrackedEvents, which floats stale events to the top
 * because closing them is the work it exists to prompt. Here the top row is
 * labelled NEXT UP, and an event that ended in March is not next up — measured
 * on the dev database, plain ascending order would have handed that headline to
 * Dandia Night 2026, five months after it finished. Finished events still
 * appear, one section down, where their meta line says what is outstanding.
 */
function bySoonest(a: EventReadiness, b: EventReadiness): number {
  if (a.hasFinished !== b.hasFinished) return a.hasFinished ? 1 : -1;
  if (a.hasFinished) return b.startsAt.getTime() - a.startsAt.getTime();
  return a.startsAt.getTime() - b.startsAt.getTime();
}

type ScorableEvent = EventRecord & {
  _count: { caps: number; stations: number; attendees: number };
};

type ScorableRole = {
  name: string;
  capacity: number;
  _count: { signups: number };
};

const plural = (n: number, one: string, many = one + "s") =>
  n + " " + (n === 1 ? one : many);

/**
 * "in 12 days" / "today" / "49 days ago" — the clock every consequence needs.
 *
 * Exported because the overview's "Other events" rows say the same thing about
 * events that are not the headline, and two spellings of "12 days" on one
 * screen is how a screen stops sounding like it was written by one person.
 */
export function whenPhrase(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil > 0) return "in " + daysUntil + " days";
  if (daysUntil === -1) return "yesterday";
  return -daysUntil + " days ago";
}

/** "Vitals or Labs" / "Vitals, Labs and 3 more" — names, not a bare count. */
function nameList(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " or " + names[1];
  return names[0] + ", " + names[1] + " and " + (names.length - 2) + " more";
}

function score(
  e: ScorableEvent,
  roles: ScorableRole[],
  now: Date,
): EventReadiness {
  const daysUntil = venueDaysUntil(e.startsAt, now);
  const base = "/admin/camps/" + e.id;
  // "Camp day" for a camp; a dandiya night does not have one.
  const dayWord = e.type === "CAMP" ? "Camp day" : "Event day";
  const clock = dayWord + " is " + whenPhrase(daysUntil) + ".";
  // Public in the sense that matters here: listed on /, taking money.
  const isPublic = e.status === "OPEN" || e.status === "ACTIVE";

  const items: ReadinessItem[] = [];

  // ── 1. Services priced, caps set ────────────────────────────────────────
  {
    const n = e._count.caps;
    items.push({
      key: "services",
      label: n > 0 ? plural(n, "service") + " priced, caps set" : "No services priced",
      done: n > 0,
      consequence:
        n > 0
          ? undefined
          : isPublic
            ? "This event is on the public events page with nothing to sell. Anyone who taps Register reaches an empty form."
            : "Nothing can go on sale until at least one service has a price.",
      action: "Price the services",
      href: base + "/services",
      brokenInPublic: n === 0 && isPublic,
    });
  }

  // ── 2. Stations in route order — CAMPS ONLY ─────────────────────────────
  // Skipped entirely for GENERAL and MEMBERSHIP_DRIVE. See the note on
  // getEventReadiness: a dandiya night has no stations and never will, so a row
  // it can never satisfy is a row that teaches people to ignore the card.
  if (e.type === "CAMP") {
    const n = e._count.stations;
    items.push({
      key: "stations",
      label: n > 0 ? plural(n, "station") + " in route order" : "No stations in route order",
      done: n > 0,
      consequence:
        n > 0 ? undefined : "Nobody can be checked in or routed to a doctor. " + clock,
      action: "Set the route order",
      href: base + "/stations",
      brokenInPublic: false,
    });
  }

  // ── 3. Registration open ────────────────────────────────────────────────
  {
    const n = e._count.attendees;
    // DRAFT is the only unfinished state here. CLOSED / PURGEABLE / PURGED are
    // the correct END of this step, not a failure of it — an event that has
    // stopped selling because it is over has not left anything undone.
    const done = e.status !== "DRAFT";
    const count = n + " registered";
    items.push({
      key: "registration",
      label: !done
        ? "Registration not open"
        : isPublic
          ? "Registration open, " + (n === 0 ? "nobody registered yet" : count)
          : "Registration closed, " + count,
      done,
      consequence: done
        ? undefined
        : "This event is not on the public events page, so nobody can register. " + clock,
      action: "Open registration",
      // The lifecycle control lives on camp detail, not on a sub-screen.
      href: base,
      brokenInPublic: false,
    });
  }

  // ── 4. Volunteer roles filled ───────────────────────────────────────────
  // Derivable from VolunteerRole.capacity and non-cancelled VolunteerSignup
  // rows since the volunteer module landed, and computed nowhere until now.
  {
    const capacity = roles.reduce((n, r) => n + r.capacity, 0);
    const filled = roles.reduce((n, r) => n + r._count.signups, 0);
    // The zero that matters: a role with a target headcount and nobody in it.
    // That is the one that leaves a station unstaffed on the day, and it is what
    // frame 1B's "No volunteers assigned to Vitals or Labs" is pointing at.
    const empty = roles.filter((r) => r.capacity > 0 && r._count.signups === 0);
    // Uncapped roles make "14 of 0" nonsense, so the label drops the denominator.
    const fill =
      capacity > 0
        ? filled + " of " + capacity + " volunteer places filled"
        : plural(filled, "volunteer") + " signed up";

    let label: string;
    let consequence: string | undefined;
    if (roles.length === 0) {
      label = "No volunteer roles defined";
      consequence =
        "Nobody can sign up to help — this event's volunteer page has no roles on it. " + clock;
    } else if (empty.length === roles.length) {
      label = "No volunteers signed up";
      consequence =
        (capacity > 0
          ? capacity + " places across " + plural(roles.length, "role") + ", none filled."
          : plural(roles.length, "role") + " defined, none filled.") +
        " " +
        clock;
    } else if (empty.length > 0) {
      label = "No volunteers assigned to " + nameList(empty.map((r) => r.name));
      consequence = clock + " " + fill + ".";
    } else {
      // A partly-filled roster is a roster in progress, not a blocker — the
      // shortfall is still on the row, it just does not stop the event.
      label = fill;
    }
    items.push({
      key: "volunteers",
      label,
      done: consequence === undefined,
      consequence,
      action: "Fill volunteer roles",
      href: base + "/volunteers",
      brokenInPublic: false,
    });
  }

  // ── 5. Policy flags reviewed ────────────────────────────────────────────
  {
    const done = e.flagsReviewedAt !== null;
    items.push({
      key: "flags",
      label: done
        ? "Registration & policy reviewed"
        : "Registration & policy not reviewed",
      done,
      consequence: done
        ? undefined
        : "Nobody has confirmed what this event's form collects, or whether it takes donations, honors membership and allows refunds.",
      action: "Review registration & policy",
      href: base,
      brokenInPublic: false,
    });
  }

  const blockers = items.filter((i) => !i.done);
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    type: e.type,
    status: e.status,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    location: e.location,
    daysUntil,
    hasFinished: e.endsAt < now,
    registered: e._count.attendees,
    items,
    done: items.length - blockers.length,
    total: items.length,
    blockers: blockers.length,
    firstBlocker: blockers[0] ?? null,
  };
}
