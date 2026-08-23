"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export type PickableEvent = { id: string; name: string; code: string };

/**
 * Which event's roster to show.
 *
 * Two renderings of one control, because a row of event-name chips is fine on a
 * laptop and is the single worst offender on a 6" phone: four events named
 * "Rhythm of Navratri 2026" wrap into a block taller than the summary it sits
 * above, and one long name is the thing that pushes the page past 375px wide.
 * Below `sm` this is a native <select> — one 48px row, and the OS renders the
 * long options full-width in its own sheet.
 *
 * The chips stay real links so the roster keeps working without JavaScript and
 * an event can be opened in a new tab; the select is the only part that needs a
 * router, and it degrades to an inert control rather than a broken one.
 */
export function EventPicker({
  events,
  selectedId,
}: {
  events: PickableEvent[];
  selectedId: string | null;
}) {
  const router = useRouter();
  if (events.length < 2) return null;

  return (
    <div>
      <label className="sm:hidden">
        <span className="sr-only">Event</span>
        <select
          value={selectedId ?? ""}
          onChange={(e) => router.push(`/admin/performances?event=${e.target.value}`)}
          className="min-h-tap w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900"
        >
          {events.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="hidden flex-wrap gap-2 sm:flex">
        {events.map((c) => (
          <Link
            key={c.id}
            href={`/admin/performances?event=${c.id}`}
            className={`flex min-h-tap items-center rounded-lg border px-3 text-sm font-medium ${
              c.id === selectedId
                ? "border-brand bg-brand text-brand-fg"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
