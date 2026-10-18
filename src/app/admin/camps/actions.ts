"use server";

import { revalidatePath } from "next/cache";
import type { EventStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { NEXT_STATUS } from "@/lib/eventLifecycle";
import { venueInputToInstant } from "@/lib/eventTime";
import {
  parseDescription,
  parseDisplayOrder,
  parseEventCode,
  parseExternalUrl,
  parseInternalNotes,
  parseVenueCapacity,
} from "@/lib/eventSetup";
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

/** The two kinds an organiser creates here. A membership drive is seeded, not set up in the UI. */
export type CreatableEventType = "CAMP" | "GENERAL";

function parseCreatableType(raw: unknown): CreatableEventType | null {
  return raw === "CAMP" || raw === "GENERAL" ? raw : null;
}

/**
 * Create an event in DRAFT. A GENERAL event (a tournament, a dinner, a dance
 * night) sells by quantity and collects no per-person details; a CAMP collects
 * attendee details because every patient gets a badge. The flag can be changed
 * on the detail page while the event is still DRAFT and nobody has paid.
 */
export async function createCamp(input: {
  name: string;
  code: string;
  type: CreatableEventType;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  // The field checks this too; this is the authority (the action is a POST
  // anything can call). One rule, shared — see src/lib/eventSetup.ts.
  const parsedCode = parseEventCode(input.code);
  if (!parsedCode.ok) return { ok: false, error: parsedCode.error };
  const code = parsedCode.value;
  const type = parseCreatableType(input.type);
  if (!type) return { ok: false, error: "Pick the kind of event." };
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
  const location = (input.location ?? "").trim();
  const description = parseDescription(input.description ?? "");
  if (!description.ok) return { ok: false, error: description.error };

  const dupe = await db.event.findUnique({
    where: { orgId_code: { orgId: org.id, code } },
  });
  if (dupe) return { ok: false, error: `Code ${code} is already used.` };

  const event = await db.event.create({
    data: {
      orgId: org.id,
      type,
      status: "DRAFT",
      name,
      code,
      startsAt,
      endsAt,
      location: location || null,
      description: description.value,
      // Quantity mode for anything that is not a camp: a dinner seat or a
      // tournament entry has a count, not a mailing address.
      collectsAttendeeDetails: type === "CAMP",
    },
  });
  revalidatePath("/admin/camps");
  // A DRAFT is not on the public rail, but the rail's candidate pool is read
  // from the same query; revalidating now is what keeps the first OPEN
  // transition from showing a stale list.
  revalidatePath("/");
  return { ok: true, id: event.id };
}

/**
 * Edit an event's label, when/where, how many the floor holds, and the
 * coordinator's own notes about running it.
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
    /**
     * The floor-capacity field AS TYPED, not a number. A blank field and a zero
     * are different answers — "no stated limit" versus a capacity nobody can be
     * admitted against — and `Number("")` is 0, which would silently turn the
     * first into the second and then fail the CHECK constraint with an error a
     * coordinator cannot act on. The raw string keeps them distinguishable all
     * the way to `parseVenueCapacity`.
     */
    venueCapacity: string;
    /**
     * Coordinator-only notes about the EVENT — venue and logistics. Never
     * rendered publicly, and never a place for anything about an attendee: the
     * event row survives PURGED, so a patient detail here outlives the purge
     * meant to erase it. See the schema comment on `Event.internalNotes`.
     */
    internalNotes: string;
    /** Public blurb under the title on /e/<slug>. Blank clears it. */
    description: string;
    /** Position on the public rail AS TYPED; blank = sort by date. See `parseDisplayOrder`. */
    displayOrder: string;
    /**
     * An event this organisation attends rather than runs (a community booth at
     * somebody else's festival): the public page names the host and links out.
     */
    externallyHosted: boolean;
    hostedByName: string;
    /** https only, never fetched. See `parseExternalUrl`. */
    externalUrl: string;
    /**
     * Changing the kind is allowed only while DRAFT with nobody paid: the kind
     * decides whether the register form collects per-person details, and an
     * order already minted under one shape cannot be re-read under the other.
     * Omit (or send the current value) to leave it alone.
     */
    type?: CreatableEventType;
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
  // Re-checked here even though the field checks it too: the field is a
  // courtesy, this is the authority. The action is a POST anything can call.
  const capacity = parseVenueCapacity(patch.venueCapacity);
  if (!capacity.ok) return { ok: false, error: capacity.error };
  const internalNotes = parseInternalNotes(patch.internalNotes);
  if (!internalNotes.ok) return { ok: false, error: internalNotes.error };
  const description = parseDescription(patch.description);
  if (!description.ok) return { ok: false, error: description.error };
  const displayOrder = parseDisplayOrder(patch.displayOrder);
  if (!displayOrder.ok) return { ok: false, error: displayOrder.error };
  const externalUrl = parseExternalUrl(patch.externalUrl);
  if (!externalUrl.ok) return { ok: false, error: externalUrl.error };
  const hostedByName = patch.hostedByName.trim();

  const current = await db.event.findFirst({
    where: { id, orgId: org.id },
    select: { type: true, status: true },
  });
  if (!current) return { ok: false, error: "Event not found." };

  // ── The kind, guarded ──
  let nextType = current.type;
  if (patch.type !== undefined && patch.type !== current.type) {
    const wanted = parseCreatableType(patch.type);
    if (!wanted) return { ok: false, error: "Pick the kind of event." };
    if (current.status !== "DRAFT") {
      return { ok: false, error: "The kind can only be changed while the event is a DRAFT." };
    }
    const paid = await db.attendee.count({
      where: { eventId: id, campId: { not: null } },
    });
    if (paid > 0) {
      return { ok: false, error: "The kind cannot change once anyone has paid." };
    }
    nextType = wanted;
  }

  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: {
      name,
      startsAt,
      endsAt,
      // Cleared back to NULL rather than "" so the public card's `e.location &&`
      // test keeps hiding the line instead of printing an empty separator.
      location: location || null,
      venueCapacity: capacity.value,
      internalNotes: internalNotes.value,
      description: description.value,
      displayOrder: displayOrder.value,
      externallyHosted: patch.externallyHosted,
      hostedByName: patch.externallyHosted && hostedByName ? hostedByName : null,
      externalUrl: externalUrl.value,
      type: nextType,
      // The kind sets the register form's mode; a change of kind resets it
      // (the detail page's flags row can still override it afterwards).
      ...(nextType !== current.type ? { collectsAttendeeDetails: nextType === "CAMP" } : {}),
    },
  });
  if (res.count === 0) return { ok: false, error: "Event not found." };
  revalidatePath(`/admin/camps/${id}`);
  // The rail reads description, display order, the host and the link.
  revalidatePath("/");
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
    namesAttendees: boolean;
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
      namesAttendees: flags.namesAttendees,
      acceptsDonations: flags.acceptsDonations,
      honorsMembership: flags.honorsMembership,
      allowsRefunds: flags.allowsRefunds,
    },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

/**
 * The `offers*` triple — which public doors this event opens.
 *
 * Separate from setEventFlags because it revalidates `/` as well: these three
 * columns are the only event settings the PUBLIC landing page reads, and that
 * page is the whole point of changing them. Leaving it out is how a coordinator
 * ticks the box, reloads the home page, sees no change and ticks it back.
 */
export async function setEventDoors(
  id: string,
  doors: {
    offersRegistration: boolean;
    offersVolunteers: boolean;
    offersVendors: boolean;
  },
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: {
      offersRegistration: doors.offersRegistration,
      offersVolunteers: doors.offersVolunteers,
      offersVendors: doors.offersVendors,
    },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  revalidatePath("/");
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
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not remove the banner.",
    };
  }
}
