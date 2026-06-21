"use server";

import { requireRole, requireTill } from "@/server/session";
import {
  getGateView,
  admitAttendee,
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

export async function admit(
  attendeeId: string,
  eventId: string,
): Promise<Result<number>> {
  await requireRole(...GATE_ROLES);
  try {
    await admitAttendee(attendeeId);
    return { ok: true, data: await getEventHeadcount(eventId) };
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
    const { attendeeIds } = await confirmGateCash(orderId);
    for (const id of attendeeIds) await admitAttendee(id);
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
): Promise<Result<number>> {
  const m = await requireTill();
  try {
    await confirmGateCash(orderId);
    await admitAttendee(attendeeId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: await getEventHeadcount(eventId) };
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
