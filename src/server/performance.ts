import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeCampId } from "@/lib/campId";
import { isKnownAgeBand } from "@/lib/performanceOptions";
import { log } from "@/lib/logger";
import {
  getStorage,
  SONG_CONTENT_TYPE,
  SONG_MAX_BYTES,
  uploadsEnabled,
} from "@/lib/storage";
import { createRegistration } from "@/server/registration";

/**
 * Competition / showcase entries — a dance group entering Rhythms of Navratri or
 * the Diwali Dhamaka showcase.
 *
 * Replaces two Google Forms in which the fee was self-certified ("Registration
 * Fee $50 click link to pay → Paid") and the stated group-size and duration
 * rules lived in question labels with nothing enforcing them. Design doc:
 * docs/superpowers/specs/2026-08-20-performance-entry-design.md
 *
 * THIS FILE DOES NOT CREATE ORDERS. Entry creation delegates to
 * createRegistration, which already owns price resolution (frozen at line
 * creation), event-open checks, donations and membership. Duplicating any of
 * that here would give competition entries a second, drifting money path — the
 * one thing decision #6 (one PaymentService, one ledger) exists to prevent.
 *
 * The entry is written alongside a PENDING order and carries no status of its
 * own: the ORDER's status is the state, and every reader here filters on
 * CONFIRMED. An abandoned checkout therefore holds no slot and appears on no
 * roster, without a second state machine to keep in sync.
 */

// ── Input ────────────────────────────────────────────────────────────────────

/**
 * `.trim()` before `.min()` on every required free-text field, for the reason
 * recorded at length in src/server/registration.ts: zod counts a space, so a
 * bare `.min(1)` accepts "   ". Here that would mean a blank group name on the
 * running order and an unreachable choreographer.
 */
export const performanceEntrySchema = z.object({
  eventId: z.string().min(1),
  /** Which fee offering on the event this entry buys. */
  serviceKey: z.string().min(1),
  registrant: z.object({
    name: z.string().trim().min(1, "Your name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().trim().min(7, "Phone is required"),
  }),
  marketingConsent: z.boolean().default(false),

  groupName: z.string().trim().min(1, "Group name is required"),
  choreographerName: z
    .string()
    .trim()
    .min(1, "Choreographer's name is required"),
  participantCount: z
    .number({ invalid_type_error: "Enter the number of participants" })
    .int("Number of participants must be a whole number")
    .min(1, "Enter the number of participants"),
  // A CLOSED vocabulary, checked server-side. The form renders a <select>, but a
  // select is a suggestion — the wire accepts whatever is posted. Without this
  // refine the field would be exactly the free text it replaced, which is how
  // the old form collected "Mixed", "mixed ages", "10 to 40" and "all" for one
  // question. See src/lib/performanceOptions.ts.
  ageRange: z
    .string()
    .trim()
    .min(1, "Pick an age group")
    .refine(isKnownAgeBand, "Pick an age group from the list"),

  songTitle: z.string().trim().min(1, "Song name is required"),
  songDelivery: z.enum(["UPLOAD", "OFFLINE"]),

  durationSeconds: z
    .number()
    .int("Duration must be a whole number of seconds")
    .min(1)
    .optional(),
  usesProps: z.boolean().optional(),
  needsStagePrep: z.boolean().optional(),
  category: z.string().trim().optional(),

  donationCents: z.number().int().min(0).optional(),
});

export type PerformanceEntryInput = z.infer<typeof performanceEntrySchema>;

export type CreatedEntry = {
  orderId: string;
  entryId: string;
  totalCents: number;
};

// ── Creation ─────────────────────────────────────────────────────────────────

/** Formats a seconds bound as the minutes a flyer would state. */
function describeSeconds(seconds: number): string {
  if (seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Create a competition entry and its PENDING order.
 *
 * The rule checks below are the entire point of replacing the Google Form: RoN
 * states 3–10 participants and 5–6 minutes, the Diwali showcase states 3–12, and
 * both collected free text. Bounds live per-event on ServiceCap beside price and
 * capacity, so a coordinator retunes them in admin without a deploy.
 */
export async function createPerformanceEntry(
  input: PerformanceEntryInput,
): Promise<CreatedEntry> {
  const data = performanceEntrySchema.parse(input);

  // findUnique + explicit guard, never findUniqueOrThrow: Prisma's NotFoundError
  // message is a ~456-char dump carrying this file's absolute path, and the
  // action layer passes plain Errors through to the buyer verbatim by design.
  const event = await db.event.findUnique({ where: { id: data.eventId } });
  if (!event) throw new Error("That event could not be found.");

  const offering = await db.serviceCap.findFirst({
    where: {
      eventId: event.id,
      serviceType: { key: data.serviceKey, active: true },
    },
    include: { serviceType: true },
  });
  if (!offering) {
    throw new Error("That entry is not offered for this event.");
  }

  // An entry may only attach to a FEE-kind service — neither admission nor
  // merch. The three kinds are documented on ServiceType: attaching an entry to
  // an admission service would mint a scannable door ticket per group at a
  // competition that grants no floor access, and attaching one to merch would
  // put a group's song on a bag of dandiya sticks.
  if (offering.serviceType.kind !== "FEE") {
    throw new Error("That entry is not offered for this event.");
  }

  if (
    offering.minParticipants !== null &&
    data.participantCount < offering.minParticipants
  ) {
    throw new Error(
      `A group needs at least ${offering.minParticipants} participants.`,
    );
  }
  if (
    offering.maxParticipants !== null &&
    data.participantCount > offering.maxParticipants
  ) {
    throw new Error(
      `A group can have at most ${offering.maxParticipants} participants.`,
    );
  }
  if (data.durationSeconds !== undefined) {
    if (
      offering.minDurationSeconds !== null &&
      data.durationSeconds < offering.minDurationSeconds
    ) {
      throw new Error(
        `The performance must be at least ${describeSeconds(offering.minDurationSeconds)}.`,
      );
    }
    if (
      offering.maxDurationSeconds !== null &&
      data.durationSeconds > offering.maxDurationSeconds
    ) {
      throw new Error(
        `The performance must be no longer than ${describeSeconds(offering.maxDurationSeconds)}.`,
      );
    }
  }

  // Quantity ALWAYS 1 — one group per checkout. createQuantityOrder mints a
  // single receipt code for a fee-only order regardless of line quantity, so a
  // qty-2 line would leave the second group with nowhere to record its details.
  // PerformanceEntry.orderId is unique at the DB to make that structural.
  const { orderId, totalCents } = await createRegistration(
    {
      eventId: event.id,
      registrant: data.registrant,
      marketingConsent: data.marketingConsent,
      donationCents: data.donationCents,
      quantities: [{ serviceKey: data.serviceKey, quantity: 1 }],
    },
    // The ONLY caller allowed to sell a fee-kind service: the group details are
    // written below in the same request.
    { allowFeeServices: true },
  );

  // The fee line to attach to. Matched by serviceType rather than taking the
  // first line, because the order may also carry a donation line.
  const feeLine = await db.lineItem.findFirst({
    where: { orderId, serviceTypeId: offering.serviceTypeId },
    select: { id: true },
  });

  const entry = await db.performanceEntry.create({
    data: {
      orgId: event.orgId,
      eventId: event.id,
      orderId,
      lineItemId: feeLine?.id ?? null,
      groupName: data.groupName,
      choreographerName: data.choreographerName,
      participantCount: data.participantCount,
      ageRange: data.ageRange,
      songTitle: data.songTitle,
      // An UPLOAD choice with no storage provider configured would strand the
      // entrant on a page that cannot accept a file, so it degrades to OFFLINE
      // and the coordinator picks it up. See getStorage().
      songDelivery: data.songDelivery === "UPLOAD" && uploadsEnabled() ? "UPLOAD" : "OFFLINE",
      durationSeconds: data.durationSeconds ?? null,
      usesProps: data.usesProps ?? null,
      needsStagePrep: data.needsStagePrep ?? null,
      category: data.category || null,
    },
    select: { id: true },
  });

  return { orderId, entryId: entry.id, totalCents };
}

// ── Capability lookup (the /perform/<code> URL) ──────────────────────────────

export type EntryView = {
  entryId: string;
  /** For the onward link to the ordinary confirmation page. */
  orderId: string;
  eventName: string;
  groupName: string;
  choreographerName: string;
  participantCount: number;
  ageRange: string;
  songTitle: string;
  songDelivery: "UPLOAD" | "OFFLINE";
  hasSongFile: boolean;
  songReadyAt: Date | null;
  campId: string;
};

/**
 * Resolve a paid entry from its receipt code.
 *
 * The code is the capability: there is no login in this flow, and a
 * choreographer returns days later from another device. It is an opaque 40-bit
 * CSPRNG token (src/lib/publicId.ts), which is what makes this safe to expose —
 * but callers MUST rate-limit, because a bare lookup endpoint is otherwise a
 * free oracle. See src/lib/rateLimit.ts.
 *
 * Returns null for anything not found AND for anything unpaid: an entry whose
 * order is still PENDING must be indistinguishable from a bad code, so a
 * cancelled checkout cannot be used to reach an upload slot it never paid for.
 */
export async function getEntryByCode(rawCode: string): Promise<EntryView | null> {
  const campId = normalizeCampId(rawCode);
  if (!campId) return null;

  const attendee = await db.attendee.findUnique({
    where: { campId },
    select: {
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { name: true } },
          performanceEntry: true,
        },
      },
    },
  });

  const order = attendee?.order;
  if (!order || order.status !== "CONFIRMED" || !order.performanceEntry) {
    return null;
  }
  const e = order.performanceEntry;

  return {
    entryId: e.id,
    orderId: order.id,
    eventName: order.event.name,
    groupName: e.groupName,
    choreographerName: e.choreographerName,
    participantCount: e.participantCount,
    ageRange: e.ageRange,
    songTitle: e.songTitle,
    songDelivery: e.songDelivery,
    hasSongFile: e.songObjectPath !== null,
    songReadyAt: e.songReadyAt,
    campId,
  };
}

// ── Song upload ──────────────────────────────────────────────────────────────

/**
 * The object path for an entry's track. DERIVED, not stored and not
 * client-supplied — so `completeSongUpload` verifies exactly the path
 * `beginSongUpload` handed out, and a replacement overwrites in place rather
 * than accumulating orphans.
 *
 * Deterministic on ids only: no group name in the path (the bucket is private,
 * but object names end up in logs and support tickets), and no random suffix,
 * because a suffix would have to be persisted for the verification step to know
 * where to look — state bought for nothing.
 */
function songObjectPath(entry: {
  orgId: string;
  eventId: string;
  id: string;
}): string {
  return `${entry.orgId}/${entry.eventId}/${entry.id}/song.mp3`;
}

export type UploadTicket = {
  url: string;
  token?: string;
  path: string;
  maxBytes: number;
  contentType: string;
};

/**
 * Mint a single-use, single-path upload URL for a paid entry.
 *
 * The browser PUTs to this directly — our function is never in the byte path,
 * so a 10 MiB body never occupies serverless memory or billed time.
 */
export async function beginSongUpload(rawCode: string): Promise<UploadTicket> {
  const storage = getStorage();
  if (!storage) {
    throw new Error(
      "File upload isn't available right now — choose to send the track to the organizers instead.",
    );
  }

  const view = await getEntryByCode(rawCode);
  if (!view) throw new Error("That entry code could not be found.");

  const entry = await db.performanceEntry.findUniqueOrThrow({
    where: { id: view.entryId },
    select: { id: true, orgId: true, eventId: true, songObjectPath: true },
  });

  const path = songObjectPath(entry);

  // Replacing: drop the old object first. Providers may refuse a signed upload
  // URL for a path that already exists, and an explicit delete is correct
  // regardless of whether a given provider supports upsert.
  if (entry.songObjectPath) {
    try {
      await storage.deleteObject("songs", entry.songObjectPath);
    } catch (err) {
      // Non-fatal: a missing old object is exactly the state we want anyway.
      log.warn("performance: could not remove replaced song object", {
        entryId: entry.id,
        err: String(err),
      });
    }
  }

  const signed = await storage.createSignedUpload("songs", path, SONG_CONTENT_TYPE);
  return {
    url: signed.url,
    token: signed.token,
    path: signed.path,
    maxBytes: SONG_MAX_BYTES,
    contentType: SONG_CONTENT_TYPE,
  };
}

/**
 * Record an upload — after confirming with the provider that it happened.
 *
 * The browser's "done" call is a CLAIM, not evidence: it uploaded directly, so
 * nothing server-side observed the transfer. Without this check `songReadyAt`
 * would ultimately rest on a client's word, and a coordinator would build a
 * running order around a track that was never sent.
 */
export async function completeSongUpload(rawCode: string): Promise<void> {
  const storage = getStorage();
  if (!storage) throw new Error("File upload isn't available right now.");

  const view = await getEntryByCode(rawCode);
  if (!view) throw new Error("That entry code could not be found.");

  const entry = await db.performanceEntry.findUniqueOrThrow({
    where: { id: view.entryId },
    select: { id: true, orgId: true, eventId: true },
  });
  const path = songObjectPath(entry);

  const info = await storage.statObject("songs", path);
  if (!info || info.sizeBytes === 0) {
    throw new Error("We didn't receive the file — please try the upload again.");
  }
  // The bucket enforces this too; re-checking here covers a misconfigured
  // bucket and is the only check the local dev adapter's byte path gets.
  if (info.sizeBytes > SONG_MAX_BYTES) {
    await storage.deleteObject("songs", path).catch(() => {});
    throw new Error(
      `That file is larger than ${Math.round(SONG_MAX_BYTES / (1024 * 1024))} MB. Trim the track or send it to the organizers instead.`,
    );
  }

  await db.performanceEntry.update({
    where: { id: entry.id },
    // Uploading is itself the choice: someone who picked OFFLINE and then
    // managed a file should not stay on the coordinator's follow-up list.
    data: { songDelivery: "UPLOAD", songObjectPath: path },
  });
}

/**
 * Switch an entry to offline delivery — the escape hatch for a wrong format, a
 * file over the limit, or a phone that will not cooperate. Drops any object so
 * storage does not keep a partial upload nobody will use.
 */
export async function chooseOfflineDelivery(rawCode: string): Promise<void> {
  const view = await getEntryByCode(rawCode);
  if (!view) throw new Error("That entry code could not be found.");

  const entry = await db.performanceEntry.findUniqueOrThrow({
    where: { id: view.entryId },
    select: { id: true, songObjectPath: true },
  });

  if (entry.songObjectPath) {
    const storage = getStorage();
    await storage?.deleteObject("songs", entry.songObjectPath).catch(() => {});
  }

  await db.performanceEntry.update({
    where: { id: entry.id },
    data: { songDelivery: "OFFLINE", songObjectPath: null, songReadyAt: null },
  });
}

// ── Coordinator surfaces ─────────────────────────────────────────────────────

export type RosterEntry = EntryView & {
  durationSeconds: number | null;
  usesProps: boolean | null;
  needsStagePrep: boolean | null;
  category: string | null;
  registrantName: string;
  registrantEmail: string;
  registrantPhone: string;
  createdAt: Date;
};

/**
 * Paid entries for an event, ordered by what still needs a human: entries with
 * no prepared track first, oldest first within each group. That ordering is the
 * roster's whole job before a running order exists.
 */
export async function listEntries(eventId: string): Promise<RosterEntry[]> {
  const rows = await db.performanceEntry.findMany({
    where: { eventId, order: { status: "CONFIRMED" } },
    include: {
      event: { select: { name: true } },
      order: {
        select: {
          registrantName: true,
          registrantEmail: true,
          registrantPhone: true,
          attendees: { select: { campId: true }, take: 1 },
        },
      },
    },
    orderBy: [{ songReadyAt: "asc" }, { createdAt: "asc" }],
  });

  // Postgres sorts NULLs last on ASC, but a null songReadyAt is precisely what
  // needs attention — so the not-ready rows are lifted to the front here rather
  // than with a raw NULLS FIRST, keeping this a plain Prisma query.
  const notReady = rows.filter((r) => r.songReadyAt === null);
  const ready = rows.filter((r) => r.songReadyAt !== null);

  return [...notReady, ...ready].map((r) => ({
    entryId: r.id,
    orderId: r.orderId,
    eventName: r.event.name,
    groupName: r.groupName,
    choreographerName: r.choreographerName,
    participantCount: r.participantCount,
    ageRange: r.ageRange,
    songTitle: r.songTitle,
    songDelivery: r.songDelivery,
    hasSongFile: r.songObjectPath !== null,
    songReadyAt: r.songReadyAt,
    campId: r.order.attendees[0]?.campId ?? "",
    durationSeconds: r.durationSeconds,
    usesProps: r.usesProps,
    needsStagePrep: r.needsStagePrep,
    category: r.category,
    registrantName: r.order.registrantName,
    registrantEmail: r.order.registrantEmail,
    registrantPhone: r.order.registrantPhone,
    createdAt: r.createdAt,
  }));
}

/**
 * A short-lived link for a coordinator to fetch one track. Always an attachment
 * download, never inline — `allowed_mime_types` validates the DECLARED type, so
 * anything rendered inline from our own origin is a stored-XSS vector.
 */
export async function songDownloadUrl(
  entryId: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const storage = getStorage();
  if (!storage) return null;

  const entry = await db.performanceEntry.findUnique({
    where: { id: entryId },
    select: { songObjectPath: true, groupName: true },
  });
  if (!entry?.songObjectPath) return null;

  // Filename the coordinator sees in Downloads. Group name is sanitized because
  // it reaches a Content-Disposition header.
  const safeName = entry.groupName.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "entry";
  return storage.createSignedDownload("songs", entry.songObjectPath,
    expiresInSeconds,
    `${safeName}.mp3`,
  );
}

/** Coordinator confirms (or un-confirms) that a prepared cut is in hand. */
export async function setSongReady(
  entryId: string,
  ready: boolean,
): Promise<void> {
  await db.performanceEntry.update({
    where: { id: entryId },
    data: { songReadyAt: ready ? new Date() : null },
  });
}

/**
 * Delete every song object for an event, keeping the entry rows.
 *
 * Called from the PURGED transition. Song files are not PII — this is storage
 * cost, and one 40-group event is ~400 MiB against a free-tier bucket. The rows
 * survive because the running order and the results are the event's record.
 */
export async function purgeEventSongs(eventId: string): Promise<number> {
  const storage = getStorage();
  const entries = await db.performanceEntry.findMany({
    where: { eventId, songObjectPath: { not: null } },
    select: { id: true, songObjectPath: true },
  });

  let deleted = 0;
  for (const e of entries) {
    if (storage && e.songObjectPath) {
      try {
        await storage.deleteObject("songs", e.songObjectPath);
        deleted++;
      } catch (err) {
        // Keep going: one unreachable object must not strand the rest.
        log.warn("performance: song purge failed for entry", {
          entryId: e.id,
          err: String(err),
        });
        continue;
      }
    }
    await db.performanceEntry.update({
      where: { id: e.id },
      data: { songObjectPath: null },
    });
  }
  return deleted;
}

// ── Listing support ──────────────────────────────────────────────────────────

export type EventOfferingKinds = {
  /** Has at least one fee-kind offering → an entry form applies. */
  hasFee: boolean;
  /** Has at least one admission or merch offering → /register applies. */
  hasOther: boolean;
};

/**
 * Which of these events sell entry fees, and which sell anything else.
 *
 * Drives the CTA on the public listings, and it has to be per-SERVICE rather
 * than per-event: prod's RON-2026 offers only `competition-entry`, while test's
 * carries a stale `floor-admission` cap alongside it. A per-event rule
 * ("fee-only ⇒ entry form") would therefore route the two environments
 * differently, which is precisely the drift that makes a staging site worthless.
 *
 * One query for the whole page — not one per card.
 */
export async function offeringKindsByEvent(
  eventIds: string[],
): Promise<Map<string, EventOfferingKinds>> {
  const out = new Map<string, EventOfferingKinds>();
  if (eventIds.length === 0) return out;

  const caps = await db.serviceCap.findMany({
    where: { eventId: { in: eventIds }, serviceType: { active: true } },
    select: {
      eventId: true,
      serviceType: { select: { kind: true } },
    },
  });

  for (const cap of caps) {
    const kinds = out.get(cap.eventId) ?? { hasFee: false, hasOther: false };
    const isFee = cap.serviceType.kind === "FEE";
    if (isFee) kinds.hasFee = true;
    else kinds.hasOther = true;
    out.set(cap.eventId, kinds);
  }
  return out;
}
