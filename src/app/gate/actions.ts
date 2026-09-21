"use server";

import { requireRole, requireTill } from "@/server/session";
import {
  getGateView,
  admitAttendee,
  searchGateGuests,
  assertAttendeeAtEvent,
  admitOrderAttendees,
  fulfillLineItems,
  fulfillOrder,
  compAdmit,
  sellAtGate,
  confirmGateCash,
  getEventHeadcount,
  type GateView,
} from "@/server/gate";

/**
 * Gate server actions. View/admit/fulfill/comp are open to gate-staffing roles;
 * anything that records CASH requires a till holder (requireTill), mirroring the
 * registration-desk till rule.
 */

const GATE_ROLES = [
  "REGISTRATION_TILL",
  "REGISTRATION_NO_TILL",
  "STATION_VOLUNTEER",
  "POS_TILL",
] as const;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(err: unknown): Result<never> {
  return { ok: false, error: err instanceof Error ? err.message : "Failed." };
}

export async function resolveGate(
  code: string,
): Promise<Result<GateView | null>> {
  await requireRole(...GATE_ROLES);
  try {
    return { ok: true, data: await getGateView(code) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The headcount AND what this particular call did.
 *
 * The headcount alone could not express "they were already in": a re-scan
 * returned the same number with ok:true, so the screen flashed "admitted" for
 * someone nobody had just let in. That is the reported bug, at the action
 * boundary rather than in CSS.
 */
/**
 * What an admit tap did, for one guest or a whole family.
 *
 * COUNTS rather than a single state, because the partial case is the one a door
 * gets wrong: three of five already inside means the volunteer hands over TWO
 * wristbands, and a boolean cannot say that. A single admit is simply the N=1
 * case, so one shape serves both and there is one path to test.
 */
export type AdmitOutcome = {
  admitted: number;
  already: number;
  headcount: number;
  /** Admit time to show: the new one, or the original if nobody was new. */
  at: Date | null;
};

/**
 * Admit one guest, or an entire party, in one call.
 *
 * TAKES A LIST AND KEEPS ITS NAME. A new exported action here would trip
 * verify-gate 3c, which regexes this file for unclassified exports -- and 3c
 * inspects export NAMES and guards, never signatures. One id is "admit this
 * one"; the whole party is "Admit all 5".
 */
export async function admit(
  attendeeIds: string[],
  eventId: string,
): Promise<Result<AdmitOutcome>> {
  await requireRole(...GATE_ROLES);
  try {
    return { ok: true, data: await admitEach(attendeeIds, eventId) };
  } catch (err) {
    return fail(err);
  }
}

/** Shared by admit and confirmUnpaidAndAdmit, so both report the same shape. */
async function admitEach(
  attendeeIds: string[],
  eventId: string,
): Promise<AdmitOutcome> {
  let admitted = 0;
  let already = 0;
  let at: Date | null = null;
  for (const id of attendeeIds) {
    const r = await admitAttendee(id, eventId);
    if (r.state === "admitted") {
      admitted++;
      at = r.at;
    } else {
      already++;
      // Only surfaces when nobody was new; a fresh admit time outranks it.
      at = at ?? r.at;
    }
  }
  return { admitted, already, headcount: await getEventHeadcount(eventId), at };
}

export async function fulfill(lineItemIds: string[]): Promise<Result<null>> {
  const m = await requireRole(...GATE_ROLES);
  try {
    await fulfillLineItems(lineItemIds, m.userId);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

export async function comp(
  eventId: string,
  count: number,
): Promise<Result<number>> {
  const m = await requireRole(...GATE_ROLES);
  try {
    await compAdmit(eventId, count, m.userId);
    return { ok: true, data: await getEventHeadcount(eventId) };
  } catch (err) {
    return fail(err);
  }
}

/** Walk-up: sell admission (+ optional merch) for cash, then admit + hand over. */
export async function sellAndAdmit(
  eventId: string,
  serviceTypeIds: string[],
  buyerName: string,
): Promise<Result<number>> {
  const m = await requireTill();
  try {
    const { orderId } = await sellAtGate(eventId, serviceTypeIds, { buyerName });
    await confirmGateCash(orderId);
    // Admits whoever this sale actually bought entry for — nobody, for a
    // competition fee. The sale still succeeds; see admitOrderAttendees.
    await admitOrderAttendees(orderId, eventId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: await getEventHeadcount(eventId) };
  } catch (err) {
    return fail(err);
  }
}

/** Pay an existing unpaid (will-call) order with cash, then admit the guest. */
export async function confirmUnpaidAndAdmit(
  orderId: string,
  attendeeId: string,
  eventId: string,
): Promise<Result<AdmitOutcome>> {
  const m = await requireTill();
  try {
    // BEFORE the cash. A ticket for another event must be refused while the
    // money is still in the guest's hand, not after it is recorded.
    await assertAttendeeAtEvent(attendeeId, eventId);
    await confirmGateCash(orderId);
    // Carries the outcome for a case that used to read as plain success: cash
    // taken from somebody who was already inside.
    const outcome = await admitEach([attendeeId], eventId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: outcome };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Find a guest when the QR will not scan -- by name, contact details, or a
 * partial code.
 *
 * OPEN_ACTIONS, not CASH_ACTIONS, and that is the whole classification: it is a
 * READ returning exactly what resolveGate already returns to exactly the same
 * roles. It changes how you ADDRESS a guest, not what you may do to one.
 * requireTill would be wrong twice -- it records no cash, and gating it on a
 * till would mean a no-till volunteer can scan a guest but cannot find one,
 * which is incoherent at a door.
 */
export async function searchGuests(
  eventId: string,
  query: string,
  eventCode?: string,
): Promise<Result<GateView[]>> {
  await requireRole(...GATE_ROLES);
  try {
    return { ok: true, data: await searchGateGuests(eventId, query, eventCode) };
  } catch (err) {
    return fail(err);
  }
}

/** Buy-more: sell merch for cash to an already-resolved attendee, then hand it over. */
export async function sellMerch(
  eventId: string,
  serviceTypeIds: string[],
  attendeeId: string,
): Promise<Result<null>> {
  const m = await requireTill();
  try {
    const { orderId } = await sellAtGate(eventId, serviceTypeIds, { attendeeId });
    await confirmGateCash(orderId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
