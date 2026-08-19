"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VENUE_TIME_ZONE } from "@/lib/eventTime";
import { updateCamp } from "../actions";

// Same field styling as CreateCampForm — the two are siblings and a coordinator
// who has used one should recognise the other.
const inputCls =
  "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function EditEventForm({
  id,
  initial,
}: {
  id: string;
  /**
   * `startsAt` / `endsAt` arrive as venue wall-clock `YYYY-MM-DDTHH:mm` strings,
   * already converted by the server component via `instantToVenueInput`. They are
   * NOT ISO instants: a `datetime-local` input has no zone, so anything handed to
   * it must already be the clock the venue reads. Converting in the browser would
   * use the visitor's zone and show a coordinator in another state a time that
   * does not match the door.
   */
  initial: { name: string; startsAt: string; endsAt: string; location: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [location, setLocation] = useState(initial.location);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateCamp(id, { name, startsAt, endsAt, location });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        Edit name, dates &amp; location
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <label className="block text-sm text-gray-600">
        Event name
        <input
          className={inputCls}
          placeholder="Event name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-sm text-gray-600">
        Starts
        <input
          type="datetime-local"
          className={inputCls}
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </label>
      <label className="block text-sm text-gray-600">
        Ends
        <input
          type="datetime-local"
          className={inputCls}
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </label>
      {/* State the consequence before it is tapped: `isRegistrationOpen` shuts
          online sales off once `endsAt` is in the past, so moving the end time is
          also a sales switch, and a coordinator fixing a typo would not guess it. */}
      <p className="text-xs text-gray-500">
        Times are venue local ({VENUE_TIME_ZONE}). Moving the end time into the
        past closes online sales for this event; moving it back into the future
        reopens them.
      </p>
      <label className="block text-sm text-gray-600">
        Location
        <input
          className={inputCls}
          placeholder="Venue and address, as it should read publicly"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>
      {/* The code is not offered here on purpose — it is the prefix of every
          ticket already issued. See the comment on `updateCamp`. */}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => {
            setName(initial.name);
            setStartsAt(initial.startsAt);
            setEndsAt(initial.endsAt);
            setLocation(initial.location);
            setError(null);
            setOpen(false);
          }}
          className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
