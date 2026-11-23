"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  INPUT_CLASS,
  ValidatedInput,
} from "@/app/_components/ValidatedInput";
import { VENUE_TIME_ZONE } from "@/lib/eventTime";
import {
  DESCRIPTION_MAX,
  INTERNAL_NOTES_MAX,
  validateDescription,
  validateDisplayOrder,
  validateExternalUrl,
  validateInternalNotes,
  validateVenueCapacity,
} from "@/lib/eventSetup";
import { updateCamp, type CreatableEventType } from "../actions";

// Same field styling as CreateCampForm and as every ValidatedInput — the forms
// are siblings and a coordinator who has used one should recognise the other.
// Pointed at the shared constant so the capacity field below, which renders
// through ValidatedInput, cannot drift from the fields around it.
const inputCls = INPUT_CLASS;

export function EditEventForm({
  id,
  initial,
  canChangeType,
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
    /** Public blurb; empty string when the column is null. */
    description: string;
    /** Rail position as a STRING, empty when null (sort by date). "0" is first. */
    displayOrder: string;
    externallyHosted: boolean;
    hostedByName: string;
    externalUrl: string;
    /** The kind as stored. MEMBERSHIP_DRIVE is seeded and shown read-only. */
    type: "CAMP" | "GENERAL" | "MEMBERSHIP_DRIVE";
  };
  /** DRAFT with nobody paid — the only state in which the kind may change. */
  canChangeType: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [location, setLocation] = useState(initial.location);
  const [venueCapacity, setVenueCapacity] = useState(initial.venueCapacity);
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes);
  const [description, setDescription] = useState(initial.description);
  const [displayOrder, setDisplayOrder] = useState(initial.displayOrder);
  const [externallyHosted, setExternallyHosted] = useState(initial.externallyHosted);
  const [hostedByName, setHostedByName] = useState(initial.hostedByName);
  const [externalUrl, setExternalUrl] = useState(initial.externalUrl);
  const [type, setType] = useState<CreatableEventType | null>(
    initial.type === "CAMP" || initial.type === "GENERAL" ? initial.type : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Computed, not stored on blur: a length ceiling is worth showing the moment
  // it is crossed, unlike "required", which would nag a field nobody has
  // engaged with yet. Same rule the server runs — never a stricter one.
  const notesIssue = validateInternalNotes(internalNotes);
  const descriptionIssue = validateDescription(description);
  const baseId = useId();
  const notesErrorId = `${baseId}-notes-error`;
  const descriptionErrorId = `${baseId}-description-error`;

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
        description,
        displayOrder,
        externallyHosted,
        hostedByName,
        externalUrl,
        // Only offered while it may change; otherwise the current kind is
        // sent back unchanged, which the action treats as "leave it".
        ...(canChangeType && type ? { type } : {}),
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
        Edit details, dates &amp; location
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

      {/* The kind. Offered only while it can still change — DRAFT, nobody
          paid — because it decides the register form's shape and an order
          minted under one shape cannot be re-read under the other. */}
      {canChangeType && type ? (
        <fieldset className="space-y-1">
          <legend className="text-sm text-gray-600">Kind of event</legend>
          <label className="flex min-h-tap items-center gap-3 text-sm">
            <input
              type="radio"
              name="edit-event-type"
              className="h-5 w-5"
              checked={type === "GENERAL"}
              onChange={() => setType("GENERAL")}
            />
            General event — sold by quantity
          </label>
          <label className="flex min-h-tap items-center gap-3 text-sm">
            <input
              type="radio"
              name="edit-event-type"
              className="h-5 w-5"
              checked={type === "CAMP"}
              onChange={() => setType("CAMP")}
            />
            Medical camp — one row per patient
          </label>
          <p className="text-xs text-gray-500">
            Changing the kind resets the registration mode below. It locks once the
            event opens or anyone pays.
          </p>
        </fieldset>
      ) : (
        <p className="text-xs text-gray-500">
          Kind: {initial.type === "CAMP" ? "medical camp" : initial.type === "GENERAL" ? "general event" : "membership drive"}
          {initial.type !== "MEMBERSHIP_DRIVE" && " — locked once the event opens or anyone has paid."}
        </p>
      )}

      <label className="block text-sm text-gray-600">
        Description
        <textarea
          className={`${inputCls} min-h-[5rem]`}
          placeholder="One short paragraph for the public event page"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          aria-invalid={descriptionIssue ? true : undefined}
          aria-describedby={descriptionIssue ? descriptionErrorId : undefined}
        />
      </label>
      {descriptionIssue ? (
        <p id={descriptionErrorId} role="alert" className="text-xs text-red-700">
          {descriptionIssue}
        </p>
      ) : (
        description.length > DESCRIPTION_MAX - 100 && (
          <p className="text-xs text-gray-500">{DESCRIPTION_MAX - description.length} characters left.</p>
        )
      )}
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
        Position on the home page
        <ValidatedInput
          value={displayOrder}
          onChange={setDisplayOrder}
          validate={validateDisplayOrder}
          inputMode="numeric"
          placeholder="blank = by date"
          aria-label="Position on the home page"
        />
      </label>
      <p className="text-xs text-gray-500">
        Lower numbers come first; 0 is the top. Leave it blank to let the date
        decide.
      </p>

      {/* An event this organisation attends rather than runs: the public page
          names the host and links out to their page. The link is https-only
          and never fetched by us. */}
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={externallyHosted}
          onChange={(e) => setExternallyHosted(e.target.checked)}
        />
        Hosted by someone else (we have a booth or a slot at their event)
      </label>
      {externallyHosted && (
        <label className="block text-sm text-gray-600">
          Host&apos;s name
          <input
            className={inputCls}
            placeholder="As it should read publicly"
            value={hostedByName}
            onChange={(e) => setHostedByName(e.target.value)}
          />
        </label>
      )}
      <label className="block text-sm text-gray-600">
        Link to the event&apos;s own page (optional)
        <ValidatedInput
          value={externalUrl}
          onChange={setExternalUrl}
          validate={validateExternalUrl}
          placeholder="https://…"
          aria-label="Link to the event's own page"
        />
      </label>

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
            setDescription(initial.description);
            setDisplayOrder(initial.displayOrder);
            setExternallyHosted(initial.externallyHosted);
            setHostedByName(initial.hostedByName);
            setExternalUrl(initial.externalUrl);
            setType(initial.type === "CAMP" || initial.type === "GENERAL" ? initial.type : null);
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
