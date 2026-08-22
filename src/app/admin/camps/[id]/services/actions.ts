"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Everything a service costs and allows AT THIS EVENT. Deliberately excludes
 * name, colour, kind and admitsCount: those are catalogue attributes shared by
 * every event, and editing them from inside one event's screen is what made an
 * org-wide rename look like a local tweak. They are edited at /admin/services.
 */
type OfferingInput = {
  priceDollars: number;
  /** Door price. Null = charge the online price at the door too. */
  onsitePriceDollars: number | null;
  earlyBirdPriceDollars: number | null;
  /** "YYYY-MM-DDTHH:mm" from a datetime-local input. Null = no early bird. */
  earlyBirdUntil: string | null;
  /** Null = uncapped. Never 0 — a DB CHECK constraint refuses it. */
  capacity: number | null;
  minParticipants: number | null;
  maxParticipants: number | null;
  /** "m:ss" exactly as typed; parsed here so the rule lives server-side. */
  minDuration: string | null;
  maxDuration: string | null;
};

/** Blank/absent door price means "same as online" — stored as NULL, not 0. */
function onsiteCents(dollars: number | null): number | null {
  if (dollars === null || Number.isNaN(dollars)) return null;
  return Math.max(0, Math.round(dollars * 100));
}

/**
 * Half an early bird is a silent mispricing: resolvePrice treats a price
 * without a deadline (or vice versa) as "no early bird," so a coordinator
 * who set one half would believe a discount was live while customers paid
 * full price. Reject before writing rather than let it resolve silently.
 *
 * A deadline being set or changed to a past instant is rejected too — the
 * resolver would never open that window, so saving it can't be what the
 * coordinator intended. `previousUntil` is the deadline already stored on this
 * offering; when the incoming deadline is exactly that same instant the
 * coordinator isn't touching the date at all — e.g. fixing a capacity a year
 * after the event — so a stale deadline from a past event must not block an
 * unrelated edit.
 */
function validateEarlyBird(
  priceDollars: number | null,
  until: string | null,
  previousUntil: Date | null,
):
  | { ok: true; priceCents: number | null; untilDate: Date | null }
  | { ok: false; error: string } {
  const hasPrice = priceDollars !== null && !Number.isNaN(priceDollars);
  const hasUntil = until !== null && until.trim() !== "";

  if (hasPrice && !hasUntil) {
    return { ok: false, error: "Early-bird price is set — also pick a deadline, or clear the price." };
  }
  if (hasUntil && !hasPrice) {
    return { ok: false, error: "Early-bird deadline is set — also enter a price, or clear the deadline." };
  }
  if (!hasPrice && !hasUntil) {
    return { ok: true, priceCents: null, untilDate: null };
  }

  const untilDate = new Date(until!);
  if (Number.isNaN(untilDate.getTime())) {
    return { ok: false, error: "Early-bird deadline is not a valid date." };
  }
  const deadlineUnchanged =
    previousUntil !== null && previousUntil.getTime() === untilDate.getTime();
  if (!deadlineUnchanged && untilDate.getTime() < Date.now()) {
    return { ok: false, error: "Early-bird deadline is in the past — pick a future date or clear it." };
  }

  return {
    ok: true,
    priceCents: Math.max(0, Math.round(priceDollars! * 100)),
    untilDate,
  };
}

/**
 * Performance lengths are stored in seconds but nobody thinks in seconds — the
 * rules a choreographer is handed read "5 to 6 minutes". Requiring m:ss removes
 * the ambiguity a bare number carries (is "6" six seconds or six minutes?),
 * which on the Google Form this replaces produced entries an order of magnitude
 * off that were only caught at the venue.
 */
function parseDuration(
  raw: string | null,
  label: string,
): { ok: true; seconds: number | null } | { ok: false; error: string } {
  if (raw === null || raw.trim() === "") return { ok: true, seconds: null };
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    return { ok: false, error: `${label} must be minutes:seconds, e.g. 5:30.` };
  }
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds <= 0) return { ok: false, error: `${label} must be longer than zero.` };
  return { ok: true, seconds };
}

/** A bound that is set must be a real count; an unset bound means "no limit". */
function normalizeCount(
  value: number | null,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || Number.isNaN(value)) return { ok: true, value: null };
  const rounded = Math.round(value);
  if (rounded < 1) {
    return { ok: false, error: `${label} must be at least 1, or left blank for no limit.` };
  }
  return { ok: true, value: rounded };
}

/**
 * Resolve the event + service, both scoped to the active org. Every action is
 * its own entry point — anything can post directly to any of them — so none may
 * assume a sibling already proved these ids belong to this tenant.
 */
async function authorize(eventId: string, serviceTypeId: string) {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false as const, error: "No active org." };

  const [event, service] = await Promise.all([
    db.event.findFirst({ where: { id: eventId, orgId: org.id }, select: { id: true } }),
    db.serviceType.findFirst({
      where: { id: serviceTypeId, orgId: org.id },
      select: { id: true, name: true, priceCents: true },
    }),
  ]);
  if (!event) return { ok: false as const, error: "Event not found." };
  if (!service) return { ok: false as const, error: "Service not found." };
  return { ok: true as const, service };
}

/**
 * Attach a catalogue service to this event. Presence of the offering IS
 * "offered here" — there is no separate flag left unticked by default, which is
 * how eleven medical services came to be listed under a community festival.
 *
 * Seeded uncapped rather than at an invented default: a made-up number stops
 * sales at a figure nobody chose. Capacity 0 is not even representable (the DB
 * rejects it) because it takes the payment and then fails confirmation.
 */
export async function addOffering(
  eventId: string,
  serviceTypeId: string,
): Promise<ActionResult> {
  const auth = await authorize(eventId, serviceTypeId);
  if (!auth.ok) return auth;

  const existing = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: `${auth.service.name} is already offered at this event.` };
  }

  await db.serviceCap.create({
    data: {
      eventId,
      serviceTypeId,
      // The catalogue price is only a starting point; the per-event price is
      // authoritative and is editable the moment the card expands.
      priceCents: auth.service.priceCents,
      capacity: null,
    },
  });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}

/** Stop offering a service at this event. Sold units make it un-removable. */
export async function removeOffering(
  eventId: string,
  serviceTypeId: string,
): Promise<ActionResult> {
  const auth = await authorize(eventId, serviceTypeId);
  if (!auth.ok) return auth;

  const cap = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId } },
    select: { id: true, sold: true },
  });
  if (!cap) return { ok: false, error: "Not offered at this event." };
  if (cap.sold > 0) {
    return {
      ok: false,
      error: `Can't remove — ${cap.sold} already sold at this event.`,
    };
  }

  await db.serviceCap.delete({ where: { id: cap.id } });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}

/** Update what a service costs and allows at THIS event. Catalogue untouched. */
export async function saveOffering(
  eventId: string,
  serviceTypeId: string,
  input: OfferingInput,
): Promise<ActionResult> {
  const auth = await authorize(eventId, serviceTypeId);
  if (!auth.ok) return auth;

  const cap = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId } },
    select: { id: true, sold: true, earlyBirdUntil: true },
  });
  if (!cap) return { ok: false, error: "Not offered at this event — add it first." };

  const earlyBird = validateEarlyBird(
    input.earlyBirdPriceDollars,
    input.earlyBirdUntil,
    cap.earlyBirdUntil,
  );
  if (!earlyBird.ok) return earlyBird;

  // Null is "uncapped". Anything else is floored at 1 rather than clamped at 0:
  // the DB refuses 0 because an offered service capped at 0 takes the payment
  // and then fails confirmation, leaving the buyer charged and empty-handed.
  let capacity: number | null = null;
  if (input.capacity !== null && !Number.isNaN(input.capacity)) {
    capacity = Math.max(1, Math.round(input.capacity));
    if (capacity < cap.sold) {
      return { ok: false, error: `Capacity can't be below ${cap.sold} already sold.` };
    }
  }

  const minParticipants = normalizeCount(input.minParticipants, "Minimum participants");
  if (!minParticipants.ok) return minParticipants;
  const maxParticipants = normalizeCount(input.maxParticipants, "Maximum participants");
  if (!maxParticipants.ok) return maxParticipants;
  if (
    minParticipants.value !== null &&
    maxParticipants.value !== null &&
    minParticipants.value > maxParticipants.value
  ) {
    return { ok: false, error: "Minimum participants is above the maximum." };
  }

  const minDuration = parseDuration(input.minDuration, "Minimum length");
  if (!minDuration.ok) return minDuration;
  const maxDuration = parseDuration(input.maxDuration, "Maximum length");
  if (!maxDuration.ok) return maxDuration;
  if (
    minDuration.seconds !== null &&
    maxDuration.seconds !== null &&
    minDuration.seconds > maxDuration.seconds
  ) {
    return { ok: false, error: "Minimum length is above the maximum." };
  }

  await db.serviceCap.update({
    where: { id: cap.id },
    data: {
      priceCents: Math.max(0, Math.round(input.priceDollars * 100)),
      onsitePriceCents: onsiteCents(input.onsitePriceDollars),
      earlyBirdPriceCents: earlyBird.priceCents,
      earlyBirdUntil: earlyBird.untilDate,
      capacity,
      minParticipants: minParticipants.value,
      maxParticipants: maxParticipants.value,
      minDurationSeconds: minDuration.seconds,
      maxDurationSeconds: maxDuration.seconds,
    },
  });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}
