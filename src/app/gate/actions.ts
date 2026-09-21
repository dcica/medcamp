"use server";

import { requireRole, requireTill } from "@/server/session";
import {
  getGateView,
  admitAttendee,
  type AdmitResult,
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
export type AdmitOutcome = { result: AdmitResult; headcount: number };

export async function admit(
  attendeeId: string,
  eventId: string,
): Promise<Result<AdmitOutcome>> {
  await requireRole(...GATE_ROLES);
  try {
    const result = await admitAttendee(attendeeId, eventId);
    return { ok: true, data: { result, headcount: await getEventHeadcount(eventId) } };
  } catch (err) {
    return fail(err);
  }
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
    await admitOrderAttendees(orderId);
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
    const result = await admitAttendee(attendeeId, eventId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: { result, headcount: await getEventHeadcount(eventId) } };
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
