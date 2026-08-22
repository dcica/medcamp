"use client";

import { useRef, useState, useTransition } from "react";
import {
  finishBannerUpload,
  removeBanner,
  requestBannerUpload,
} from "../actions";

/**
 * Event banner upload.
 *
 * The file goes straight from the browser to storage via a signed, single-path
 * URL — our function is never in the byte path, so a 5 MiB poster never occupies
 * serverless memory. Same mechanism as the performance song upload; see
 * src/lib/storage.ts.
 *
 * Before this, `imageUrl` could only be set by editing prisma/seed-events.ts and
 * committing a JPEG to /public/events, so a new poster needed an engineer and a
 * deploy.
 */
export function BannerUpload({
  eventId,
  initialUrl,
  maxBytes,
  uploadsAvailable,
}: {
  eventId: string;
  initialUrl: string | null;
  maxBytes: number;
  uploadsAvailable: boolean;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const maxMb = Math.round(maxBytes / (1024 * 1024));
  // Seeded banners are static files in /public, not storage objects. They can be
  // replaced but there is nothing to delete, so the copy shouldn't imply there is.
  const isSeeded = Boolean(url && url.startsWith("/events/"));

  async function onFile(file: File) {
    setError(null);
    // Client-side checks are UX; the bucket is the real gate. Checking here
    // means an 8 MB photo is refused instantly rather than after a long upload
    // on a phone connection.
    if (file.size > maxBytes) {
      setError(
        `That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${maxMb} MB.`,
      );
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Banners must be a JPEG, PNG or WebP image.");
      return;
    }

    setBusy(true);
    const ticket = await requestBannerUpload(eventId, file.type);
    if (!ticket.ok) {
      setBusy(false);
      setError(ticket.error);
      return;
    }
    try {
      const res = await fetch(ticket.ticket.url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": ticket.ticket.contentType,
          ...(ticket.ticket.token
            ? { Authorization: `Bearer ${ticket.ticket.token}` }
            : {}),
        },
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Upload failed.");
      return;
    }

    // The server now confirms with storage that the object really landed before
    // it writes imageUrl — otherwise the public events page could render a
    // poster that does not exist.
    const saved = await finishBannerUpload(eventId, ticket.ticket.path);
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setUrl(saved.imageUrl);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeBanner(eventId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUrl(null);
    });
  }

  const working = busy || pending;

  return (
    <div>
      {url ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Event banner"
            className="max-h-48 w-full object-cover"
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          No banner. The event card shows a text-only tile without one.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {uploadsAvailable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* The label IS the tap target: a bare file input is unstyleable and
              renders around 20px on Android, well under the 48px floor. */}
          <label
            className={`flex min-h-tap flex-1 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg ${
              working ? "opacity-60" : "cursor-pointer"
            }`}
          >
            {working ? "Uploading…" : url ? "Replace banner" : "Upload banner"}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={working}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
          {url && !isSeeded && (
            <button
              type="button"
              onClick={onRemove}
              disabled={working}
              className="flex min-h-tap items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Image upload isn&apos;t configured on this environment, so the banner
          can only be set in the seed for now.
        </p>
      )}

      <p className="mt-2 text-xs text-gray-500">
        JPEG, PNG or WebP, up to {maxMb} MB. Posters run at their natural ratio on
        the public card, so upload the artwork uncropped.
      </p>
    </div>
  );
}
