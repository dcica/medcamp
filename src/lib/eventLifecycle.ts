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
