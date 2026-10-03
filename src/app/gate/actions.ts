"use server";

import { requireRole, requireTill } from "@/server/session";
import { createCheckoutForOrder } from "@/server/payments";
import { db } from "@/lib/db";
import type { GateSaleItem } from "@/lib/ticketMinting";
import {
  getGateView,
  admitAttendee,
  getGateCatalog,
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
/**
 * Start a CARD sale at the door: build the order, hand back a Checkout URL.
 *
 * THE GUEST PAYS ON THEIR OWN PHONE. The gate renders the returned URL as a
 * QR; the guest scans it, pays, and the webhook confirms. The volunteer's
 * phone is never handed over and is free for the next person in the queue
 * while this one is paying.
 *
 * NO TILL REQUIRED, and that is deliberate rather than an oversight. The
 * till exists because CASH is untracked value in somebody's pocket — it is
 * a capability about handling notes, not about selling. A card sale creates
 * an auditable Stripe charge and the volunteer never touches money, so
 * gating it behind `canHoldTill` would block the lower-risk path while
 * leaving the higher-risk one open. Any GATE_ROLE may take a card.
 *
 * The order is left PENDING. Nothing is admitted and no capacity is claimed
 * until the webhook calls confirmOrderPaid — which is the same rule the
 * online path lives by, and the reason a half-finished payment cannot let
 * anybody in.
 */
export async function startCardSale(
  eventId: string,
  items: GateSaleItem[],
  buyerName: string,
): Promise<
  Result<{ orderId: string; url: string; qr: string; totalCents: number }>
> {
  await requireRole(...GATE_ROLES);
  try {
    const { orderId, totalCents } = await sellAtGate(eventId, items, {
      buyerName,
      method: "STRIPE",
    });
    // Default routes: success lands the GUEST on /confirm/<orderId>, which
    // shows their own QR on the phone they just paid with. Cancel goes back
    // to /register rather than /scan — the guest must never be dropped onto
    // a staff screen.
    const { url } = await createCheckoutForOrder(orderId);
    // Rendered HERE, not in the browser. `qrcode` is already a dependency
    // for the confirmation email and the wallet page, and generating it
    // server-side keeps the station free of another client bundle on a
    // phone that is already running a camera.
    const QRCode = (await import("qrcode")).default;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    return { ok: true, data: { orderId, url, qr, totalCents } };
  } catch (err) {
    return fail(await asDoorCopy(err, eventId));
  }
}

/**
 * Has that card sale landed yet?
 *
 * Polled by the gate while the QR is on screen. The WEBHOOK is the authority
 * — this only reads what it wrote. It deliberately does not confirm anything
 * itself: a door screen that could mark an order paid would be a way to
 * admit people without a charge.
 *
 * Admits on the FIRST poll that sees CONFIRMED, then keeps returning the
 * same shape. admitOrderAttendees is idempotent, so a slow network that
 * double-polls cannot double-admit.
 */
export async function pollCardSale(
  orderId: string,
  eventId: string,
): Promise<Result<{ paid: boolean; admitted: number; headcount: number }>> {
  const m = await requireRole(...GATE_ROLES);
  try {
    const order = await db.order.findFirst({
      where: { id: orderId, eventId },
      select: { status: true },
    });
    if (!order) return fail("Order not found.");
    if (order.status !== "CONFIRMED") {
      return {
        ok: true,
        data: {
          paid: false,
          admitted: 0,
          headcount: await getEventHeadcount(eventId),
        },
      };
    }
    const res = await admitOrderAttendees(orderId, eventId);
    await fulfillOrder(orderId, m.userId);
    return {
      ok: true,
      data: {
        paid: true,
        admitted: res.admitted,
        headcount: await getEventHeadcount(eventId),
      },
    };
  } catch (err) {
    return fail(await asDoorCopy(err, eventId));
  }
}

export async function sellAndAdmit(
  eventId: string,
  items: GateSaleItem[],
  buyerName: string,
): Promise<Result<number>> {
  const m = await requireTill();
  try {
    const { orderId } = await sellAtGate(eventId, items, { buyerName });
    // The capacity claim happens inside confirmGateCash, AFTER the cash is
    // in hand. If it throws, the volunteer needs a number and an item name,
    // not `Service "vg-admission" is at capacity`.
    await confirmGateCash(orderId);
    // Admits whoever this sale actually bought entry for — nobody, for a
    // competition fee. The sale still succeeds; see admitOrderAttendees.
    await admitOrderAttendees(orderId, eventId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: await getEventHeadcount(eventId) };
  } catch (err) {
    return fail(await asDoorCopy(err, eventId));
  }
}

/**
 * Turn an OverCapacityError into something readable at a door.
 *
 * It carries a serviceKey, which is an internal identifier no volunteer has
 * seen before. They need the item's NAME and how many are actually left, so
 * they can sell that many instead of starting over.
 */
async function asDoorCopy(err: unknown, eventId: string): Promise<unknown> {
  if (!(err instanceof Error) || err.name !== "OverCapacityError") return err;
  const key = (err as { serviceKey?: string }).serviceKey;
  const catalog = await getGateCatalog(eventId);
  const all = [...catalog.admission, ...catalog.merch, ...catalog.fees];
  const hit = all.find((i) => i.id === key) ?? null;
  const left = hit?.remaining ?? 0;
  const what = hit?.name ?? "That item";
  return new Error(
    left > 0
      ? `Only ${left} ${what} left — sell ${left}.`
      : `${what} is sold out — nothing was charged.`,
  );
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
  items: GateSaleItem[],
  attendeeId: string,
): Promise<Result<null>> {
  const m = await requireTill();
  try {
    const { orderId } = await sellAtGate(eventId, items, { attendeeId });
    await confirmGateCash(orderId);
    await fulfillOrder(orderId, m.userId);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
