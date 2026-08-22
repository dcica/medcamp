import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import {
  BANNER_CONTENT_TYPES,
  BANNER_MAX_BYTES,
  getStorage,
  uploadsEnabled,
} from "@/lib/storage";

/**
 * Event banner artwork.
 *
 * Until now `Event.imageUrl` could only be set by editing prisma/seed-events.ts
 * and committing a JPEG to /public/events — three of them are in the repo,
 * about 1 MB of binary in git, and a coordinator with a new poster had to ask an
 * engineer. This puts the upload in the admin UI.
 *
 * Reuses the storage seam built for song uploads (src/lib/storage.ts), with one
 * deliberate difference: banners live in a PUBLIC bucket. A song is fetched once
 * by one coordinator through a short-lived signed URL; a banner is rendered to
 * every anonymous visitor on the events page, where a signed URL would expire
 * mid-session and defeat next/image's caching.
 */

/** Where an event's banner lives. Derived from the id, so replacing overwrites. */
function bannerPath(eventId: string, ext: string): string {
  return `${eventId}/banner.${ext}`;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type BannerTicket = {
  url: string;
  token?: string;
  path: string;
  maxBytes: number;
  contentType: string;
};

/**
 * Mint a single-use upload URL for an event banner.
 *
 * The browser PUTs straight to storage, so a 5 MiB image never occupies
 * serverless memory. The caller must already have checked the coordinator's
 * authorization — this module does not gate.
 */
export async function beginBannerUpload(
  eventId: string,
  contentType: string,
): Promise<BannerTicket> {
  const storage = getStorage();
  if (!storage) {
    throw new Error(
      "Image upload isn't configured. Set the Supabase storage keys, or set the banner URL by hand for now.",
    );
  }
  if (!BANNER_CONTENT_TYPES.includes(contentType)) {
    throw new Error("Banners must be a JPEG, PNG or WebP image.");
  }

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, imageUrl: true },
  });
  if (!event) throw new Error("That event could not be found.");

  // Replacing: drop the old object first. The extension is part of the path, so
  // a JPEG replaced by a PNG would otherwise leave the JPEG orphaned and still
  // being served until the row is updated.
  await removeStoredBanner(event.imageUrl);

  const path = bannerPath(eventId, EXT_BY_TYPE[contentType]);
  const signed = await storage.createSignedUpload("banners", path, contentType);
  return {
    url: signed.url,
    token: signed.token,
    path: signed.path,
    maxBytes: BANNER_MAX_BYTES,
    contentType,
  };
}

/**
 * Record a finished banner upload, after confirming with the provider that it
 * actually landed.
 *
 * The browser's "done" is a claim: it uploaded directly, so nothing server-side
 * observed the transfer. Without this check an event could carry an imageUrl
 * pointing at nothing, and the public events page would render a broken poster.
 */
export async function completeBannerUpload(
  eventId: string,
  path: string,
): Promise<string> {
  const storage = getStorage();
  if (!storage) throw new Error("Image upload isn't configured.");

  // The path is derived server-side in beginBannerUpload, so a client-supplied
  // one that does not match this event is either a bug or an attempt to point
  // one event's banner at another's object.
  if (!path.startsWith(`${eventId}/`)) {
    throw new Error("That upload doesn't belong to this event.");
  }

  const info = await storage.statObject("banners", path);
  if (!info || info.sizeBytes === 0) {
    throw new Error("We didn't receive the image — please try again.");
  }
  if (info.sizeBytes > BANNER_MAX_BYTES) {
    await storage.deleteObject("banners", path).catch(() => {});
    throw new Error(
      `That image is larger than ${Math.round(BANNER_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }

  const url = storage.publicUrl("banners", path);
  await db.event.update({ where: { id: eventId }, data: { imageUrl: url } });
  return url;
}

/** Clear an event's banner and delete the object behind it. */
export async function clearBanner(eventId: string): Promise<void> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { imageUrl: true },
  });
  await removeStoredBanner(event?.imageUrl ?? null);
  await db.event.update({ where: { id: eventId }, data: { imageUrl: null } });
}

/**
 * Delete the object behind a banner URL, if we own it.
 *
 * Deliberately a no-op for the seeded `/events/*.jpeg` paths: those are static
 * files committed to /public, not storage objects, and there is nothing to
 * delete. Clearing such an event simply drops the reference.
 */
async function removeStoredBanner(imageUrl: string | null): Promise<void> {
  if (!imageUrl || !uploadsEnabled()) return;
  const marker = "/banner.";
  if (!imageUrl.includes(marker)) return;
  const storage = getStorage();
  if (!storage) return;
  // Recover "<eventId>/banner.<ext>" from the tail of the URL.
  const parts = imageUrl.split("/");
  const path = parts.slice(-2).join("/").split("?")[0];
  try {
    await storage.deleteObject("banners", path);
  } catch (err) {
    // Non-fatal: a missing old object is the state we wanted anyway.
    log.warn("banner: could not remove replaced object", { path, err: String(err) });
  }
}
