"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Blank/absent door price means "same as online" — stored as NULL, not 0. */
function onsiteCents(dollars: number | null): number | null {
  if (dollars === null || Number.isNaN(dollars)) return null;
  return Math.max(0, Math.round(dollars * 100));
}

type RowInput = {
  name: string;
  priceDollars: number;
  colorHex: string;
  hasLab: boolean;
  fulfillable: boolean;
  /** Issues a scannable ticket. Off for a pure fee (e.g. competition entry). */
  admits: boolean;
  /** Door price in dollars. Null/blank = charge the online price at the door. */
  onsitePriceDollars: number | null;
  active: boolean;
  /** Whether this service is offered at THIS event (controls cap existence). */
  offered: boolean;
  capacity: number;
  /** Promotional price in dollars. Null = no early bird. */
  earlyBirdPriceDollars: number | null;
  /** ISO datetime-local string, e.g. "2026-09-15T23:59". Null = no early bird. */
  earlyBirdUntil: string | null;
};

/**
 * Half an early bird is a silent mispricing: resolvePrice treats a price
 * without a deadline (or vice versa) as "no early bird," so a coordinator
 * who set one half would believe a discount was live while customers paid
 * full price. Reject before writing rather than let it resolve silently.
 *
 * A deadline being set or changed to a past instant is rejected too — the
 * resolver would never open that window, so saving it can't be what the
 * coordinator intended. `previousUntil` is the deadline already stored on
 * this cap (null for a brand-new row); when the incoming deadline is exactly
 * that same instant, the coordinator isn't touching the date at all — e.g.
 * fixing a typo in the service name a year after the event — so a stale
 * deadline from a past event must not block an unrelated edit.
 */
function validateEarlyBird(
  priceDollars: number | null,
  until: string | null,
  previousUntil: Date | null,
): { ok: true; priceCents: number | null; untilDate: Date | null } | { ok: false; error: string } {
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
  const deadlineUnchanged = previousUntil !== null && previousUntil.getTime() === untilDate.getTime();
  if (!deadlineUnchanged && untilDate.getTime() < Date.now()) {
    return { ok: false, error: "Early-bird deadline is in the past — pick a future date or clear it." };
  }

  return {
    ok: true,
    priceCents: Math.max(0, Math.round(priceDollars! * 100)),
    untilDate,
  };
}

/** Create a new catalogue service + offer it at this camp (cap with price). */
export async function createService(
  eventId: string,
  input: Omit<RowInput, "active" | "offered">,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const event = await db.event.findFirst({ where: { id: eventId, orgId: org.id } });
  if (!event) return { ok: false, error: "Camp not found." };

  const key = slugify(input.name);
  if (!key) return { ok: false, error: "Name must contain letters or numbers." };

  const exists = await db.serviceType.findUnique({
    where: { orgId_key: { orgId: org.id, key } },
  });
  if (exists) return { ok: false, error: `A service "${key}" already exists.` };

  // A brand-new row has no stored deadline to fall back on — any past
  // deadline here is one the coordinator just typed in.
  const earlyBird = validateEarlyBird(input.earlyBirdPriceDollars, input.earlyBirdUntil, null);
  if (!earlyBird.ok) return earlyBird;

  const priceCents = Math.max(0, Math.round(input.priceDollars * 100));
  const service = await db.serviceType.create({
    data: {
      orgId: org.id,
      key,
      name: input.name.trim(),
      // Catalogue default price (seeds future offerings); per-event price below.
      priceCents,
      colorHex: input.colorHex,
      hasLab: input.hasLab,
      fulfillable: input.fulfillable,
      admits: input.admits,
    },
  });
  await db.serviceCap.create({
    data: {
      eventId,
      serviceTypeId: service.id,
      priceCents,
      onsitePriceCents: onsiteCents(input.onsitePriceDollars),
      capacity: Math.max(0, Math.round(input.capacity)),
      earlyBirdPriceCents: earlyBird.priceCents,
      earlyBirdUntil: earlyBird.untilDate,
    },
  });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}

/**
 * Update a service's catalogue attributes (org-wide) and its per-event offering.
 * Price + capacity live on the per-event cap; toggling `offered` adds/removes the
 * offering (and thus whether the service appears in this event's registration).
 */
export async function saveServiceRow(
  eventId: string,
  serviceId: string,
  input: RowInput,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const service = await db.serviceType.findFirst({
    where: { id: serviceId, orgId: org.id },
  });
  if (!service) return { ok: false, error: "Service not found." };

  const priceCents = Math.max(0, Math.round(input.priceDollars * 100));
  const onsitePriceCents = onsiteCents(input.onsitePriceDollars);
  const capacity = Math.max(0, Math.round(input.capacity));
  const existingCap = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
  });

  // Only validated when a cap is actually being written (the `offered`
  // branch below) — un-offering deletes the cap, so stale early-bird form
  // state left over in the UI must not block dropping the offering.
  const earlyBird = input.offered
    ? validateEarlyBird(
        input.earlyBirdPriceDollars,
        input.earlyBirdUntil,
        existingCap?.earlyBirdUntil ?? null,
      )
    : null;
  if (earlyBird && !earlyBird.ok) return earlyBird;

  // Catalogue attributes (org-wide). Price is NOT here — it's per-event.
  const updateCatalog = db.serviceType.update({
    where: { id: serviceId },
    data: {
      name: input.name.trim(),
      colorHex: input.colorHex,
      hasLab: input.hasLab,
      fulfillable: input.fulfillable,
      admits: input.admits,
      active: input.active,
    },
  });

  if (!input.offered) {
    if (existingCap && existingCap.sold > 0) {
      return {
        ok: false,
        error: `Can't remove — ${existingCap.sold} already sold this camp.`,
      };
    }
    await db.$transaction([
      updateCatalog,
      ...(existingCap
        ? [db.serviceCap.delete({ where: { id: existingCap.id } })]
        : []),
    ]);
  } else {
    if (existingCap && capacity < existingCap.sold) {
      return {
        ok: false,
        error: `Capacity can't be below ${existingCap.sold} already sold.`,
      };
    }
    // Computed above (and already confirmed ok) whenever input.offered is
    // true, which is this branch — never null here.
    const validated = earlyBird as { ok: true; priceCents: number | null; untilDate: Date | null };
    const earlyBirdPriceCents = validated.priceCents;
    const earlyBirdUntil = validated.untilDate;
    await db.$transaction([
      updateCatalog,
      db.serviceCap.upsert({
        where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
        update: { priceCents, onsitePriceCents, capacity, earlyBirdPriceCents, earlyBirdUntil },
        create: {
          eventId,
          serviceTypeId: serviceId,
          priceCents,
          onsitePriceCents,
          capacity,
          earlyBirdPriceCents,
          earlyBirdUntil,
        },
      }),
    ]);
  }
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}
