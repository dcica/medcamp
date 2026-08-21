"use client";

import { useRef, useState, useTransition } from "react";
import {
  finishSongUpload,
  requestSongUpload,
  switchToOfflineDelivery,
} from "../actions";

/**
 * Song delivery for one paid entry: upload an MP3, or hand it over offline.
 *
 * The upload is a direct PUT to a signed URL the server mints — the file never
 * passes through a route handler, so a 10 MiB track never occupies serverless
 * memory or billed time. A plain `fetch` is used rather than the provider's
 * browser SDK precisely so the local-disk dev adapter is interchangeable with
 * Supabase: both hand back a URL you PUT bytes to, and nothing here knows which
 * one answered.
 *
 * Phone-first: one column, 48px targets, and every state reachable with one
 * thumb while standing up.
 */

type Delivery = "UPLOAD" | "OFFLINE";

type Props = {
  code: string;
  initialDelivery: Delivery;
  initialHasFile: boolean;
  songReady: boolean;
  maxBytes: number;
  uploadsAvailable: boolean;
  contactEmail: string;
};

export function SongDelivery({
  code,
  initialDelivery,
  initialHasFile,
  songReady,
  maxBytes,
  uploadsAvailable,
  contactEmail,
}: Props) {
  const [delivery, setDelivery] = useState<Delivery>(initialDelivery);
  const [hasFile, setHasFile] = useState(initialHasFile);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const maxMb = Math.round(maxBytes / (1024 * 1024));

  async function onFileChosen(file: File) {
    setError(null);
    setNotice(null);

    // Client-side checks are UX, not enforcement — the bucket is the real gate
    // (see src/lib/storage.ts). Checking here means a 40 MB file is refused
    // instantly instead of after a long upload on a phone connection.
    if (file.size > maxBytes) {
      setError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${maxMb} MB. Trim the track, or choose to send it to the organizers below.`,
      );
      return;
    }
    if (file.size === 0) {
      setError("That file is empty. Pick the track again.");
      return;
    }
    const looksMp3 =
      file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
    if (!looksMp3) {
      setError(
        "We can only accept MP3 files here. Choose to send it to the organizers below and we'll sort it out with you.",
      );
      return;
    }

    setProgress(0);
    const ticketResult = await requestSongUpload(code);
    if (!ticketResult.ok) {
      setProgress(null);
      setError(ticketResult.error);
      return;
    }

    try {
      const res = await fetch(ticketResult.ticket.url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": ticketResult.ticket.contentType,
          // Supabase's signed-upload endpoint carries its grant in the URL's
          // token param; the header is sent only when a provider hands one back.
          ...(ticketResult.ticket.token
            ? { Authorization: `Bearer ${ticketResult.ticket.token}` }
            : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
    } catch (err) {
      setProgress(null);
      setError(
        `We couldn't upload that file — ${err instanceof Error ? err.message : "please try again"}. If it keeps failing, choose to send it to the organizers below.`,
      );
      return;
    }

    // The server now re-checks with the provider that the object really landed.
    // Until this succeeds the entry does NOT count as having a track.
    const finished = await finishSongUpload(code);
    setProgress(null);
    if (!finished.ok) {
      setError(finished.error);
      return;
    }

    setHasFile(true);
    setDelivery("UPLOAD");
    setNotice("Got it — your track is with us.");
    if (fileRef.current) fileRef.current.value = "";
  }

  function chooseOffline() {
    setError(null);
    startTransition(async () => {
      const result = await switchToOfflineDelivery(code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDelivery("OFFLINE");
      setHasFile(false);
      setNotice("Noted — an organizer will contact you about your track.");
    });
  }

  // Coordinator has a prepared cut in hand. Nothing left for the entrant to do,
  // and re-uploading now would silently diverge from what the tech has queued.
  if (songReady) {
    return (
      <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <h2 className="text-base font-bold text-green-900">Music confirmed</h2>
        <p className="mt-2 text-sm text-green-800">
          An organizer has your track ready for the show. If something needs to
          change, email{" "}
          <a href={`mailto:${contactEmail}`} className="underline">
            {contactEmail}
          </a>{" "}
          — please don&apos;t upload a different file at this point.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-bold text-gray-900">Your music</h2>

      {notice && (
        <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {delivery === "OFFLINE" ? (
        <>
          <p className="mt-3 text-sm text-gray-700">
            You&apos;ve asked to send your track to the organizers directly.
            We&apos;ll be in touch before the event. You can still upload an MP3
            here if that turns out to be easier.
          </p>
          {uploadsAvailable && (
            <FilePicker
              inputRef={fileRef}
              busy={progress !== null || pending}
              maxMb={maxMb}
              label="Upload an MP3 instead"
              onFile={onFileChosen}
            />
          )}
        </>
      ) : (
        <>
          {hasFile ? (
            <p className="mt-3 text-sm text-gray-700">
              We have your track. An organizer will check it and confirm — you
              can replace it below until then.
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-700">
              Send us the exact cut you&apos;ll perform to. MP3 only, up to{" "}
              {maxMb} MB.
            </p>
          )}

          {uploadsAvailable ? (
            <FilePicker
              inputRef={fileRef}
              busy={progress !== null || pending}
              maxMb={maxMb}
              label={hasFile ? "Replace the track" : "Choose your MP3"}
              onFile={onFileChosen}
            />
          ) : (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Uploads aren&apos;t available right now. Email your track to{" "}
              <a href={`mailto:${contactEmail}`} className="underline">
                {contactEmail}
              </a>
              .
            </p>
          )}

          <button
            type="button"
            onClick={chooseOffline}
            disabled={pending || progress !== null}
            className="mt-4 flex min-h-tap w-full items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50"
          >
            I&apos;ll send it to the organizers instead
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Choose this if your file isn&apos;t an MP3, is bigger than {maxMb} MB,
            or you&apos;d rather hand it over another way.
          </p>
        </>
      )}
    </section>
  );
}

function FilePicker({
  inputRef,
  busy,
  maxMb,
  label,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  maxMb: number;
  label: string;
  onFile: (file: File) => void;
}) {
  return (
    <div className="mt-4">
      {/* The label IS the tap target — a bare file input is unstyleable and
          renders as a ~20px control on Android, well under the 48px floor. */}
      <label
        className={`flex min-h-tap w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg ${
          busy ? "opacity-60" : "cursor-pointer"
        }`}
      >
        {busy ? "Uploading…" : label}
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      <p className="mt-2 text-xs text-gray-500">MP3, up to {maxMb} MB.</p>
    </div>
  );
}
