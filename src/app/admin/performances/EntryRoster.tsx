"use client";

import { useMemo, useState, useTransition } from "react";
import type { RosterEntry } from "@/server/performance";
import {
  musicState,
  MUSIC_BADGE_LABEL,
  MUSIC_FILTER_LABEL,
  MUSIC_SLUG,
  MUSIC_STATES,
  type MusicState,
} from "@/lib/musicState";
import { setSongReadyAction, songDownloadUrlAction } from "./actions";

/**
 * The roster itself. Cards rather than a table on purpose: a coordinator checks
 * this on a phone between other jobs, and a nine-column table would need
 * horizontal scrolling, which the phone-first constraint rules out.
 *
 * The music chips are a FILTER, not decoration. The four states are four
 * different jobs — a phone call, a reminder email, ten minutes with headphones,
 * nothing — and chasing is done one job at a time, so the list has to narrow to
 * one. Counts come from `musicState` in src/lib/musicState.ts, the same call the
 * badges and the server summary make; that is what stops the number at the top
 * of the page from disagreeing with the badges underneath it again.
 */
export function EntryRoster({
  entries,
  eventId,
}: {
  entries: RosterEntry[];
  eventId: string;
}) {
  const [filter, setFilter] = useState<MusicState | null>(null);

  /**
   * Rows a coordinator has just marked (or un-marked) ready, held here rather
   * than inside each card. The chip counts, the filtered list and the badge all
   * have to agree the instant a button is pressed; a card that owned its own
   * "ready" flag would show "Track ready" while the Confirmed chip still read
   * one lower until the server round trip landed — the same two-sources-of-truth
   * bug this screen already had, rebuilt at a smaller scale.
   */
  const [readyOverride, setReadyOverride] = useState<Record<string, Date | null>>({});

  const view = useMemo(
    () =>
      entries.map((e) =>
        e.entryId in readyOverride
          ? { ...e, songReadyAt: readyOverride[e.entryId] }
          : e,
      ),
    [entries, readyOverride],
  );

  const counts = useMemo(() => {
    const acc = Object.fromEntries(MUSIC_STATES.map((s) => [s, 0])) as Record<
      MusicState,
      number
    >;
    for (const e of view) acc[musicState(e)]++;
    return acc;
  }, [view]);

  // Order is NOT recomputed after a toggle. The server sorts needs-a-human
  // first; re-sorting here would make the card jump out from under the finger
  // that just marked it. The next refresh reorders it.
  const rows = filter ? view.filter((e) => musicState(e) === filter) : view;

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
        No paid entries yet. Groups appear here the moment their fee clears.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip
          label="All"
          count={view.length}
          active={filter === null}
          onClick={() => setFilter(null)}
        />
        {MUSIC_STATES.map((state) => (
          <Chip
            key={state}
            label={MUSIC_FILTER_LABEL[state]}
            count={counts[state]}
            active={filter === state}
            onClick={() => setFilter(filter === state ? null : state)}
          />
        ))}
      </div>

      <ScopedActions rows={rows} eventId={eventId} filter={filter} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          Nothing in {filter ? MUSIC_FILTER_LABEL[filter].toLowerCase() : "this list"}.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => (
            <EntryCard
              key={e.entryId}
              entry={e}
              onReadyChange={(at) =>
                setReadyOverride((prev) => ({ ...prev, [e.entryId]: at }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-tap items-center gap-2 rounded-full border px-3 text-sm font-medium ${
        active
          ? "border-brand bg-brand text-brand-fg"
          : "border-gray-300 bg-white text-gray-700"
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums ${active ? "opacity-90" : "font-semibold text-gray-900"}`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Copy addresses and export — both scoped to what is ON SCREEN.
 *
 * The point of narrowing to "Needs chasing" is to write to those five people.
 * Handing over all forty addresses at that moment is not a convenience, it is
 * the wrong list, and the mistake is invisible once it is pasted into a mail
 * client. So the button counts what it will copy, and says so.
 */
function ScopedActions({
  rows,
  eventId,
  filter,
}: {
  rows: RosterEntry[];
  eventId: string;
  filter: MusicState | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  // One address per person, not per entry: a dance school enters three groups
  // under one contact, and pasting them three times is how a chase email starts
  // with an apology.
  const emails = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const key = r.registrantEmail.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, r.registrantEmail.trim());
    }
    return [...seen.values()];
  }, [rows]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setNotice(`Copied ${emails.length} address${emails.length === 1 ? "" : "es"}.`);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // in-app browsers. Say so rather than silently doing nothing.
      setNotice("Your browser blocked the clipboard — select the addresses manually.");
    }
  }

  const csvHref = `/api/reports/performances?event=${encodeURIComponent(eventId)}${
    filter ? `&music=${MUSIC_SLUG[filter]}` : ""
  }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={emails.length === 0}
          className="flex min-h-tap items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          Copy {emails.length} email{emails.length === 1 ? "" : "s"}
          {filter ? " in view" : ""}
        </button>
        <a
          href={csvHref}
          className="flex min-h-tap items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700"
        >
          Export CSV{filter ? " in view" : ""} ↓
        </a>
      </div>
      {notice && <p className="text-xs text-gray-600">{notice}</p>}
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "not given";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Three states, three answers. A blank is not a "No". */
function formatTriState(v: boolean | null): string {
  return v === null ? "not answered" : v ? "Yes" : "No";
}

const MUSIC_STYLE: Record<MusicState, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  RECEIVED: "bg-blue-100 text-blue-700",
  OFFLINE: "bg-amber-100 text-amber-800",
  AWAITING_UPLOAD: "bg-gray-100 text-gray-600",
};

function EntryCard({
  entry,
  onReadyChange,
}: {
  entry: RosterEntry;
  onReadyChange: (songReadyAt: Date | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const state = musicState(entry);
  const ready = state === "CONFIRMED";

  function toggleReady() {
    setError(null);
    const next = !ready;
    startTransition(async () => {
      const result = await setSongReadyAction(entry.entryId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onReadyChange(next ? new Date() : null);
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
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${MUSIC_STYLE[state]}`}
        >
          {MUSIC_BADGE_LABEL[state]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Choreographer" value={entry.choreographerName} />
        <Row label="Dancers" value={`${entry.participantCount} · ${entry.ageRange}`} />
        <Row label="Song" value={entry.songTitle} />
        <Row label="Length" value={formatDuration(entry.durationSeconds)} />
        {/* Always shown, including when unanswered: a missing Props row read as
            "no props" to whoever was building the stage plot. */}
        <Row label="Props" value={formatTriState(entry.usesProps)} />
        <Row label="Stage setup" value={formatTriState(entry.needsStagePrep)} />
      </dl>

      <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
        <div className="text-gray-500">Contact</div>
        <div className="text-gray-900">{entry.registrantName}</div>
        <div className="flex flex-wrap gap-x-4">
          <a
            href={`mailto:${entry.registrantEmail}`}
            className="inline-flex min-h-tap min-w-0 items-center break-all text-brand underline"
          >
            {entry.registrantEmail}
          </a>
          <a
            href={`tel:${entry.registrantPhone}`}
            className="inline-flex min-h-tap items-center text-brand underline"
          >
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
