"use server";

import { revalidatePath } from "next/cache";
import type { EventStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { NEXT_STATUS } from "@/lib/eventLifecycle";
import { venueInputToInstant } from "@/lib/eventTime";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin, requireCoordinator } from "@/server/admin";
import {
  beginBannerUpload,
  clearBanner,
  completeBannerUpload,
} from "@/server/banners";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/** Allowed forward transitions in the purge state machine (decision #4). */
// Single copy, shared with the buttons in CampControls.tsx so the two cannot
// drift. See src/lib/eventLifecycle.ts.
const NEXT = NEXT_STATUS;

export async function createCamp(input: {
  name: string;
  code: string;
  startsAt: string;
  endsAt: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name) return { ok: false, error: "Name is required." };
  if (!/^[A-Z]{2,4}-\d{4}[SW]$/.test(code)) {
    return { ok: false, error: "Code must look like MC-2026W." };
  }
  // Venue wall clock in, UTC instant out. NOT `new Date(input.startsAt)` — that
  // parses the input's bare wall-clock string in the server's zone (UTC on
  // Vercel) and shifted every camp created here five hours earlier. See
  // `venueInputToInstant`.
  const startsAt = venueInputToInstant(input.startsAt);
  const endsAt = venueInputToInstant(input.endsAt);
  if (!startsAt || !endsAt) {
    return { ok: false, error: "Valid start and end dates required." };
  }
  if (endsAt < startsAt) {
    return { ok: false, error: "End must be after the start." };
  }

  const dupe = await db.event.findUnique({
    where: { orgId_code: { orgId: org.id, code } },
  });
  if (dupe) return { ok: false, error: `Code ${code} is already used.` };

  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "CAMP",
      status: "DRAFT",
      name,
      code,
      startsAt,
      endsAt,
    },
  });
  revalidatePath("/admin/camps");
  return { ok: true, id: event.id };
}

/**
 * Edit an event's label and when/where.
 *
 * `code` is deliberately NOT patchable. It is identity, not a label: it is the
 * prefix `formatCampId` mints every ticket number from (`GARBA-2026-0015`), so
 * changing it after a single ticket exists orphans every code already sitting in
 * a guest's confirmation email and printed on their pass. Renaming the event is
 * safe; renumbering the tickets is not. Do not add it as a field.
 */
export async function updateCamp(
  id: string,
  patch: {
    name: string;
    startsAt: string;
    endsAt: string;
    location: string;
  },
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = patch.name.trim();
  // Venue wall clock in, UTC instant out — see `venueInputToInstant`. A plain
  // `new Date(patch.startsAt)` here would read the datetime-local string in the
  // server's zone and move every saved time five hours.
  const startsAt = venueInputToInstant(patch.startsAt);
  const endsAt = venueInputToInstant(patch.endsAt);
  if (!name || !startsAt || !endsAt) {
    return { ok: false, error: "Name and valid dates required." };
  }
  if (endsAt < startsAt) {
    return { ok: false, error: "End must be after the start." };
  }
  const location = patch.location.trim();

  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: {
      name,
      startsAt,
      endsAt,
      // Cleared back to NULL rather than "" so the public card's `e.location &&`
      // test keeps hiding the line instead of printing an empty separator.
      location: location || null,
    },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

export async function transitionCamp(
  id: string,
  target: EventStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const event = await db.event.findFirst({ where: { id, orgId: org.id } });
  if (!event) return { ok: false, error: "Camp not found." };

  if (!NEXT[event.status].includes(target)) {
    return { ok: false, error: `Can't move from ${event.status} to ${target}.` };
  }

  // PURGED is destructive — coordinator-only, strips PII, keeps anon counts.
  if (target === "PURGED") {
    await requireCoordinator();
    await db.$transaction([
      db.attendee.updateMany({
        where: { eventId: id, orgId: org.id },
        data: { name: null, mailingAddress: null, piiPurgedAt: new Date() },
      }),
      db.event.update({
        where: { id },
        data: { status: "PURGED", purgedAt: new Date() },
      }),
    ]);
    revalidatePath(`/admin/camps/${id}`);
    return { ok: true };
  }

  await db.event.update({
    where: { id },
    data: {
      status: target,
      ...(target === "CLOSED" ? { closedAt: new Date() } : {}),
    },
  });
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

/** Per-event configuration flags (registration mode, donation, membership, refund). */
export async function setEventFlags(
  id: string,
  flags: {
    collectsAttendeeDetails: boolean;
    acceptsDonations: boolean;
    honorsMembership: boolean;
    allowsRefunds: boolean;
  },
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: {
      collectsAttendeeDetails: flags.collectsAttendeeDetails,
      acceptsDonations: flags.acceptsDonations,
      honorsMembership: flags.honorsMembership,
      allowsRefunds: flags.allowsRefunds,
    },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

export async function setWalkIn(
  id: string,
  open: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: { walkInOpensAt: open ? new Date() : null },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

// ── Event banner ─────────────────────────────────────────────────────────────

export type BannerTicketResult =
  | { ok: true; ticket: Awaited<ReturnType<typeof beginBannerUpload>> }
  | { ok: false; error: string };

/** Mint an upload URL for this event's banner. Coordinator/committee only. */
export async function requestBannerUpload(
  eventId: string,
  contentType: string,
): Promise<BannerTicketResult> {
  try {
    await requireAdmin();
    const ticket = await beginBannerUpload(eventId, contentType);
    return { ok: true, ticket };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start the upload.",
    };
  }
}

export type BannerSaveResult =
  | { ok: true; imageUrl: string }
  | { ok: false; error: string };

/**
 * Record a finished banner upload. Verifies with the storage provider that the
 * object exists before writing imageUrl — the browser uploaded directly, so its
 * success report is a claim, not evidence.
 */
export async function finishBannerUpload(
  eventId: string,
  path: string,
): Promise<BannerSaveResult> {
  try {
    await requireAdmin();
    const imageUrl = await completeBannerUpload(eventId, path);
    revalidatePath(`/admin/camps/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/");
    return { ok: true, imageUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not save the banner.",
    };
  }
}

/** Remove this event's banner. */
export async function removeBanner(eventId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await clearBanner(eventId);
    revalidatePath(`/admin/camps/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not remove the banner.",
    };
  }
}
