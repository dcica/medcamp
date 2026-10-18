"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { INPUT_CLASS, ValidatedInput } from "@/app/_components/ValidatedInput";
import { DESCRIPTION_MAX, validateDescription, validateEventCode } from "@/lib/eventSetup";
import { createCamp, type CreatableEventType } from "./actions";

// Shared with EditEventForm and every ValidatedInput: the two forms are
// siblings and a coordinator who has used one should recognise the other.
const inputCls = INPUT_CLASS;

/**
 * Create an event in DRAFT. The kind is the one decision that shapes everything
 * after it — a GENERAL event sells by quantity, a CAMP collects a row per
 * patient — so it is asked here, up front, in the organiser's words.
 */
export function CreateCampForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<CreatableEventType>("GENERAL");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Same rule the server runs — never a stricter one (see ValidatedInput).
  const descriptionIssue = validateDescription(description);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCamp({ name, code, type, startsAt, endsAt, location, description });
      if (res.ok && res.id) router.push(`/admin/camps/${res.id}`);
      else if (!res.ok) setError(res.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        + New event
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <input
        className={inputCls}
        placeholder="Event name (e.g. Spring Pickleball Open 2026)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Event name"
      />
      <ValidatedInput
        value={code}
        onChange={(v) => setCode(v.toUpperCase())}
        validate={validateEventCode}
        className="uppercase"
        placeholder="Code (e.g. PB-OPEN-2026)"
        aria-label="Event code"
      />
      {/* The code is the prefix of every ticket number and cannot change later;
          say so here, where it is being chosen. */}
      <p className="text-xs text-gray-500">
        The code starts every ticket number for this event (PB-OPEN-2026-K7M2XQ9T) and
        cannot be changed once set. Letters, digits and dashes only.
      </p>

      <fieldset className="space-y-1">
        <legend className="text-sm text-gray-600">Kind of event</legend>
        <label className="flex min-h-tap items-center gap-3 text-sm">
          <input
            type="radio"
            name="event-type"
            className="h-5 w-5"
            checked={type === "GENERAL"}
            onChange={() => setType("GENERAL")}
          />
          <span>
            <span className="font-medium">General event</span> — tickets, entries, seats or
            tables sold by quantity (a tournament, a dinner, a dance night)
          </span>
        </label>
        <label className="flex min-h-tap items-center gap-3 text-sm">
          <input
            type="radio"
            name="event-type"
            className="h-5 w-5"
            checked={type === "CAMP"}
            onChange={() => setType("CAMP")}
          />
          <span>
            <span className="font-medium">Medical camp</span> — one row per patient, services
            per person, stations and badges
          </span>
        </label>
      </fieldset>

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
      <label className="block text-sm text-gray-600">
        Location (optional)
        <input
          className={inputCls}
          placeholder="Venue and address, as it should read publicly"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>
      <label className="block text-sm text-gray-600">
        Description (optional)
        <textarea
          className={`${inputCls} min-h-[5rem]`}
          placeholder="One short paragraph for the public event page"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={descriptionIssue ? true : undefined}
        />
      </label>
      {descriptionIssue ? (
        <p role="alert" className="text-xs text-red-700">
          {descriptionIssue}
        </p>
      ) : (
        description.length > DESCRIPTION_MAX - 100 && (
          <p className="text-xs text-gray-500">{DESCRIPTION_MAX - description.length} characters left.</p>
        )
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
