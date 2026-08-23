"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  INPUT_CLASS,
  ValidatedInput,
} from "@/app/_components/ValidatedInput";
import { VENUE_TIME_ZONE } from "@/lib/eventTime";
import {
  INTERNAL_NOTES_MAX,
  validateInternalNotes,
  validateVenueCapacity,
} from "@/lib/eventSetup";
import { updateCamp } from "../actions";

// Same field styling as CreateCampForm and as every ValidatedInput — the forms
// are siblings and a coordinator who has used one should recognise the other.
// Pointed at the shared constant so the capacity field below, which renders
// through ValidatedInput, cannot drift from the fields around it.
const inputCls = INPUT_CLASS;

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
  initial: {
    name: string;
    startsAt: string;
    endsAt: string;
    location: string;
    /**
     * The stored capacity as a STRING, empty when the column is null. Kept as
     * text end to end because "" and "0" must stay distinguishable: null means
     * the venue has no stated limit, 0 is a number the database refuses.
     */
    venueCapacity: string;
    /** Coordinator notes; empty string when the column is null. */
    internalNotes: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [location, setLocation] = useState(initial.location);
  const [venueCapacity, setVenueCapacity] = useState(initial.venueCapacity);
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Computed, not stored on blur: a length ceiling is worth showing the moment
  // it is crossed, unlike "required", which would nag a field nobody has
  // engaged with yet. Same rule the server runs — never a stricter one.
  const notesIssue = validateInternalNotes(internalNotes);
  const notesErrorId = `${useId()}-notes-error`;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateCamp(id, {
        name,
        startsAt,
        endsAt,
        location,
        venueCapacity,
        internalNotes,
      });
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
      <label className="block text-sm text-gray-600">
        Floor capacity
        <ValidatedInput
          value={venueCapacity}
          onChange={setVenueCapacity}
          validate={validateVenueCapacity}
          inputMode="numeric"
          placeholder="e.g. 400"
          aria-label="Floor capacity"
        />
      </label>
      {/* Named and explained for what it does at the door, not for the column it
          writes. Blank is a real answer here and the hint has to say so, or a
          coordinator with no stated limit will invent a number. */}
      <p className="text-xs text-gray-500">
        How many people the venue holds. The door screen counts admissions
        against this figure. Leave it blank if there is no limit — the door then
        shows a plain headcount with no bar.
      </p>

      <label className="block text-sm text-gray-600">
        Notes for the team
        <textarea
          className={`${inputCls} min-h-[7rem]`}
          placeholder="Load-in 4pm, sound desk Ravi 555-0134, park behind the hall, key with the temple office"
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          aria-label="Notes for the team"
          aria-invalid={notesIssue ? true : undefined}
          aria-describedby={notesIssue ? notesErrorId : undefined}
        />
      </label>
      {/* The No-PHI rule in a coordinator's words, on the screen, not behind a
          help panel — because this is the moment someone would type the thing we
          promise never to store, and the event row is never purged. */}
      <p className="text-xs text-gray-500">
        Only your team sees this — it is never on the public page or in an
        email. Venue and logistics only: nothing about a patient or an
        attendee, not even a name. These notes are kept after the event, when
        attendee details have already been deleted.
      </p>
      {notesIssue ? (
        <p id={notesErrorId} role="alert" className="text-xs text-red-700">
          {notesIssue}
        </p>
      ) : (
        internalNotes.length > INTERNAL_NOTES_MAX - 300 && (
          <p className="text-xs text-gray-500">
            {INTERNAL_NOTES_MAX - internalNotes.length} characters left.
          </p>
        )
      )}

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
            setVenueCapacity(initial.venueCapacity);
            setInternalNotes(initial.internalNotes);
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
