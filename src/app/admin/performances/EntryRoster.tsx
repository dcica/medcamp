"use client";

import { useState, useTransition } from "react";
import type { RosterEntry } from "@/server/performance";
import { setSongReadyAction, songDownloadUrlAction } from "./actions";

/**
 * The roster itself. Cards rather than a table on purpose: a coordinator checks
 * this on a phone between other jobs, and a nine-column table would need
 * horizontal scrolling, which the phone-first constraint rules out.
 */
export function EntryRoster({ entries }: { entries: RosterEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
        No paid entries yet. Groups appear here the moment their fee clears.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <EntryCard key={e.entryId} entry={e} />
      ))}
    </ul>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "not given";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function EntryCard({ entry }: { entry: RosterEntry }) {
  const [ready, setReady] = useState(entry.songReadyAt !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleReady() {
    setError(null);
    const next = !ready;
    startTransition(async () => {
      const result = await setSongReadyAction(entry.entryId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReady(next);
    });
  }

  function download() {
    setError(null);
    startTransition(async () => {
      const result = await songDownloadUrlAction(entry.entryId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The signed URL is short-lived and minted per click, so it is used
      // immediately rather than rendered into the page.
      window.location.href = result.url;
    });
  }

  const musicLabel = ready
    ? "Track ready"
    : entry.hasSongFile
      ? "File received"
      : entry.songDelivery === "OFFLINE"
        ? "Offline — needs contact"
        : "No file yet";

  const musicStyle = ready
    ? "bg-green-100 text-green-700"
    : entry.hasSongFile
      ? "bg-blue-100 text-blue-700"
      : entry.songDelivery === "OFFLINE"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-gray-900">
            {entry.groupName}
          </div>
          <div className="font-mono text-xs text-gray-500">{entry.campId}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${musicStyle}`}
        >
          {musicLabel}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Choreographer" value={entry.choreographerName} />
        <Row label="Dancers" value={`${entry.participantCount} · ${entry.ageRange}`} />
        <Row label="Song" value={entry.songTitle} />
        <Row label="Length" value={formatDuration(entry.durationSeconds)} />
        {entry.usesProps !== null && (
          <Row label="Props" value={entry.usesProps ? "Yes" : "No"} />
        )}
        {entry.needsStagePrep !== null && (
          <Row label="Stage setup" value={entry.needsStagePrep ? "Yes" : "No"} />
        )}
      </dl>

      <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
        <div className="text-gray-500">Contact</div>
        <div className="text-gray-900">{entry.registrantName}</div>
        <div className="flex flex-wrap gap-x-4">
          <a href={`mailto:${entry.registrantEmail}`} className="text-brand underline">
            {entry.registrantEmail}
          </a>
          <a href={`tel:${entry.registrantPhone}`} className="text-brand underline">
            {entry.registrantPhone}
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggleReady}
          disabled={pending}
          className={`flex min-h-tap flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
            ready
              ? "border border-gray-300 text-gray-700"
              : "bg-brand text-brand-fg"
          }`}
        >
          {ready ? "Un-mark track ready" : "Mark track ready"}
        </button>
        {entry.hasSongFile && (
          <button
            type="button"
            onClick={download}
            disabled={pending}
            className="flex min-h-tap items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50"
          >
            Download MP3
          </button>
        )}
      </div>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate text-right font-medium text-gray-900">{value}</dd>
    </>
  );
}
