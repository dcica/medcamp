import type { EventStatus } from "@prisma/client";

/**
 * The event lifecycle state machine — the single copy.
 *
 * This table was duplicated in src/app/admin/camps/actions.ts (the server guard)
 * and src/app/admin/camps/[id]/CampControls.tsx (the buttons). Two copies of a
 * permission table is the same defect class as a menu that lists a page you
 * cannot open: the UI offers a move the server then refuses, or hides one it
 * would allow. One copy, imported by both.
 *
 * WHY `OPEN -> CLOSED` EXISTS. It did not, and the omission was expensive. An
 * event that has finished while still OPEN could only reach CLOSED via ACTIVE —
 * so closing a festival that ended seven weeks ago required first pressing
 * "Start day-of" and making it live, which promotes it to the current event and
 * takes over the dashboard. Measured on test: JUL4-2026 (49 days past) and
 * IND-2026 (6 days past) were both stuck OPEN, and the only exit ran through
 * making them ACTIVE.
 *
 * CLOSED matters beyond tidiness — src/server/registration.ts documents it as
 * "load-bearing rather than housekeeping", because a finished event left OPEN
 * keeps selling and can own the default registration page indefinitely.
 */
export const NEXT_STATUS: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["OPEN"],
  // CLOSED is reachable directly: an event can finish, or be called off, without
  // ever having a day-of.
  OPEN: ["ACTIVE", "CLOSED", "DRAFT"],
  ACTIVE: ["CLOSED"],
  CLOSED: ["PURGEABLE"],
  PURGEABLE: ["PURGED"],
  PURGED: [],
};

/**
 * Button labels. "Event", not "camp" — the same record backs the medical camp
 * and every general event (Garba, Dandiya, Diwali), and a coordinator closing
 * the Festival of Lights should not be asked to close a camp.
 */
export const STATUS_ACTION_LABEL: Record<EventStatus, string> = {
  DRAFT: "Back to draft",
  OPEN: "Open registration",
  ACTIVE: "Start day-of",
  CLOSED: "Close event",
  PURGEABLE: "Mark purgeable",
  PURGED: "Purge patient data",
};

/**
 * Whether closing this event would end it before its scheduled finish — the
 * case worth confirming, because it stops sales early. Closing an event that
 * already ended is the routine, expected action and must not nag.
 */
export function isEarlyClose(endsAt: Date, now: Date = new Date()): boolean {
  return endsAt > now;
}

/**
 * Pill colors for a status, one copy.
 *
 * This map was byte-identical in src/app/admin/page.tsx and
 * src/app/admin/camps/[id]/page.tsx. Two copies of a color table is the same
 * defect class as the two copies of NEXT_STATUS above, only quieter: nothing
 * breaks when they drift, a CLOSED camp simply turns amber on one screen and
 * grey on the next, and the coordinator learns that the colors mean nothing.
 *
 * Typed `Record<EventStatus, string>` rather than `Record<string, string>` — the
 * looser type let a lookup miss return `undefined` and render an unstyled pill,
 * which is what a renamed status would have done.
 *
 * Deliberately NOT tenant-themeable. Status colors carry meaning across tenants;
 * a brand-red "paid" chip at a gate is a safety problem.
 */
export const STATUS_STYLE: Record<EventStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  OPEN: "bg-green-100 text-green-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  CLOSED: "bg-amber-100 text-amber-700",
  PURGEABLE: "bg-orange-100 text-orange-700",
  PURGED: "bg-gray-200 text-gray-500",
};

/* ------------------------------------------------------------------------- *
 * The lifecycle rail — the five-segment "where is this event" strip.
 * ------------------------------------------------------------------------- */

export type LifecycleStage = {
  /** Shown when the event is not sitting inside this segment. */
  label: EventStatus;
  /** Every status this one segment stands for, in lifecycle order. */
  covers: EventStatus[];
};

/**
 * PURGEABLE is folded FORWARD into the segment after it.
 *
 * The rail is a progress strip, and the two purge statuses are one phase of an
 * event's life told in two beats: PURGEABLE means "the data may now go",
 * PURGED means "it is gone". Giving each its own segment would spend a fifth of
 * a 343px-wide phone rail on a distinction only the purge screen acts on, and
 * would make every live event render as 2-of-6 when it is really 2-of-5. The
 * segment still says PURGEABLE when the event is actually PURGEABLE — see
 * `stageLabel` — so nothing is hidden, it just does not get its own slot.
 */
const FOLDED_FORWARD = new Set<EventStatus>(["PURGEABLE"]);

/**
 * The longest DRAFT-to-terminal path through NEXT_STATUS.
 *
 * DERIVED, NOT LISTED. A second hardcoded order is the defect NEXT_STATUS was
 * written to end: add a status to the machine and a hand-written rail silently
 * stops describing it. The walk takes the LONGEST path rather than the first
 * one because NEXT_STATUS contains genuine shortcuts — `OPEN -> CLOSED` skips
 * ACTIVE for an event that is called off — and a shortcut is not the lifecycle.
 * Visited-set recursion, so the backward `OPEN -> DRAFT` edge cannot loop.
 */
function longestPath(from: EventStatus, seen: EventStatus[] = []): EventStatus[] {
  const path = [...seen, from];
  let best: EventStatus[] = path;
  for (const next of NEXT_STATUS[from]) {
    if (path.includes(next)) continue;
    const candidate = longestPath(next, path);
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function buildRail(): LifecycleStage[] {
  const stages: LifecycleStage[] = [];
  let pending: EventStatus[] = [];
  for (const status of longestPath("DRAFT")) {
    pending.push(status);
    if (FOLDED_FORWARD.has(status)) continue;
    stages.push({ label: status, covers: pending });
    pending = [];
  }
  // A trailing fold with nothing after it still deserves a segment.
  if (pending.length > 0) {
    stages.push({ label: pending[pending.length - 1], covers: pending });
  }
  return stages;
}

/** DRAFT · OPEN · ACTIVE · CLOSED · PURGED, derived from NEXT_STATUS above. */
export const LIFECYCLE_RAIL: LifecycleStage[] = buildRail();

/** Which segment an event is sitting in. Never -1: every status is covered. */
export function railPositionOf(status: EventStatus): number {
  return LIFECYCLE_RAIL.findIndex((s) => s.covers.includes(status));
}

/**
 * What a segment is called right now. A folded segment takes the name of the
 * status the event is actually in, so a PURGEABLE event reads PURGEABLE rather
 * than being told its data is already gone.
 */
export function stageLabel(stage: LifecycleStage, status: EventStatus): EventStatus {
  return stage.covers.includes(status) ? status : stage.label;
}
