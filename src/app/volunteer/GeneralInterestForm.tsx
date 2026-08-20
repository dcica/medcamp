"use client";

import { useState, useTransition } from "react";
import type { VolunteerAgeBand } from "@prisma/client";
import { AGE_BANDS } from "@/lib/volunteerRoles";
import { submitGeneralInterest } from "./actions";

/**
 * Register-your-interest form, for when there is no event to sign up to — or
 * when there is one and the person wants to help generally rather than work
 * that particular day.
 *
 * Shorter than the event form on purpose. It asks only what makes someone
 * reachable and placeable later: who they are, how to contact them, their age
 * band (which gates roles), and optionally school, skills and languages. It
 * does NOT ask for a counselor, guardian consent, emergency contact or t-shirt
 * size — those attach to a specific shift on a specific day, and collecting
 * them against no commitment would be collecting consent for nothing.
 *
 * Phone-first per the UI constraint: single column, 48px tap targets, no
 * horizontal scroll at 6".
 */
export function GeneralInterestForm({ sourceTag }: { sourceTag: string | null }) {
  const [v, setV] = useState({
    name: "",
    email: "",
    phone: "",
    ageBand: "" as VolunteerAgeBand | "",
    school: "",
    skills: "",
    languages: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { alreadyKnown: boolean }>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<typeof v>) =>
    setV((prev) => ({ ...prev, ...patch }));

  function submit() {
    setError(null);
    if (!v.name.trim()) return setError("Name is required.");
    if (!v.email.trim()) return setError("Email is required.");
    if (!v.phone.trim()) return setError("Phone is required.");
    if (!v.ageBand) return setError("Please pick an age group.");

    startTransition(async () => {
      const res = await submitGeneralInterest({
        ...v,
        ageBand: v.ageBand as VolunteerAgeBand,
        sourceTag: sourceTag ?? undefined,
      });
      if (res.ok) setDone({ alreadyKnown: res.alreadyKnown });
      else setError(res.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-brand bg-white p-5">
        <h2 className="text-lg font-bold text-brand">
          {done.alreadyKnown ? "Your details are updated" : "Thank you — you're on the list"}
        </h2>
        {/* Says what will actually happen and what will not. There is no
            subscriber system behind this, so promising alerts would be a lie
            about software nobody has written. */}
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          {done.alreadyKnown
            ? "We already had you on the volunteer list and have saved your latest details."
            : "A volunteer coordinator has your details and will be in touch when signups open for the next event."}{" "}
          Nothing is automated — a person reads this list.
        </p>
      </div>
    );
  }

  const field =
    "mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base";
  const label = "block text-sm font-medium text-gray-700";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className={label} htmlFor="gi-name">
            Name
          </label>
          <input
            id="gi-name"
            className={field}
            value={v.name}
            autoComplete="name"
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div>
          <label className={label} htmlFor="gi-email">
            Email
          </label>
          <input
            id="gi-email"
            type="email"
            inputMode="email"
            className={field}
            value={v.email}
            autoComplete="email"
            onChange={(e) => set({ email: e.target.value })}
          />
        </div>

        <div>
          <label className={label} htmlFor="gi-phone">
            Phone
          </label>
          <input
            id="gi-phone"
            type="tel"
            inputMode="tel"
            className={field}
            value={v.phone}
            autoComplete="tel"
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>

        <div>
          <label className={label} htmlFor="gi-age">
            Age group
          </label>
          <select
            id="gi-age"
            className={field}
            value={v.ageBand}
            onChange={(e) =>
              set({ ageBand: e.target.value as VolunteerAgeBand | "" })
            }
          >
            <option value="">Select…</option>
            {AGE_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          {/* Not gatekeeping — it decides which roles a person can be offered
              later, since roles carry a minimum age. */}
          <p className="mt-1 text-xs text-gray-500">
            Some roles have a minimum age, so this helps us match you.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="gi-school">
            School or organization <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="gi-school"
            className={field}
            value={v.school}
            onChange={(e) => set({ school: e.target.value })}
          />
        </div>

        <div>
          <label className={label} htmlFor="gi-skills">
            Anything you would like to help with{" "}
            <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="gi-skills"
            className={field}
            value={v.skills}
            placeholder="Setup, registration desk, food stall…"
            onChange={(e) => set({ skills: e.target.value })}
          />
        </div>

        <div>
          <label className={label} htmlFor="gi-languages">
            Languages you speak <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="gi-languages"
            className={field}
            value={v.languages}
            placeholder="Hindi, Gujarati, Telugu…"
            onChange={(e) => set({ languages: e.target.value })}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="mt-5 flex min-h-tap w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60"
      >
        {pending ? "Sending…" : "Add me to the volunteer list"}
      </button>
    </div>
  );
}
