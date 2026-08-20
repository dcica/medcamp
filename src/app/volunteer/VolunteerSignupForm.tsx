"use client";

import { useMemo, useState, useTransition } from "react";
import type { VolunteerAgeBand } from "@prisma/client";
import {
  AGE_BANDS,
  bandMeetsMinAge,
  counselorPairRequired,
  hoursApprovalUrlIssue,
  isMinorBand,
} from "@/lib/volunteerRoles";
import { ValidatedInput, validateEmail } from "@/app/_components/ValidatedInput";
import type { RoleOption } from "@/server/volunteers";
import { submitVolunteerSignup } from "./actions";

/**
 * Phone-first volunteer signup (UI Constraint: 6" phone, 48px taps, single
 * column). Counselor capture is first-class: when a student gives a school or is
 * under 18, the counselor name + email become required — that's the recruitment
 * link the org reaches back to each term. Minors also need guardian consent.
 *
 * THE INVARIANT (same one ValidatedInput.tsx spells out): nothing here may
 * reject what volunteerSignupSchema accepts. The counselor requirement and the
 * hours-approval-link rule are not re-implemented — this file calls the very
 * functions the schema calls (counselorPairRequired, hoursApprovalUrlIssue), so
 * they are identical by construction. The one rule that is not shared, the
 * counselor email FORMAT, uses validateEmail, which is documented as strictly
 * looser than the server's z.email(). Erring loose costs a round trip; erring
 * strict costs a volunteer we never hear from again.
 */
export function VolunteerSignupForm({
  roles,
  sourceTag,
}: {
  roles: RoleOption[];
  sourceTag: string | null;
}) {
  const [v, setV] = useState({
    name: "",
    email: "",
    phone: "",
    ageBand: "" as VolunteerAgeBand | "",
    school: "",
    skills: "",
    languages: "",
    tshirtSize: "",
    emergencyName: "",
    emergencyPhone: "",
    roleId: "",
    counselorName: "",
    counselorEmail: "",
    counselorTitle: "",
    hoursApprovalUrl: "",
    guardianName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<typeof v>) => setV((prev) => ({ ...prev, ...patch }));

  const band = v.ageBand || null;
  const minor = band ? isMinorBand(band) : false;
  // Same call the schema makes. Two triggers: a school or a minor (the older,
  // stricter rule), OR content in either counselor field — because a counselor
  // name with no email cannot be stored at all (Counselor.email is the dedupe
  // key), so it used to be accepted here and silently discarded on the server.
  const { required: counselorRequired } = counselorPairRequired({
    school: v.school,
    ageBand: band,
    counselorName: v.counselorName,
    counselorEmail: v.counselorEmail,
  });

  const counselorNameIssue = (value: string): string | null =>
    value.trim() || !counselorRequired
      ? null
      : "Add the counselor / advisor name too — we can't record an approver from an email alone.";

  const counselorEmailIssue = (value: string): string | null => {
    if (!value.trim()) {
      return counselorRequired
        ? "Add a valid counselor / advisor email — a name on its own can't be saved."
        : null;
    }
    return validateEmail(value);
  };

  // CROSS-FIELD messages. ValidatedInput validates a field on its own blur and
  // stays quiet on an empty field nobody has engaged with — right for a normal
  // required field, wrong here: the whole point of the pairwise rule is that one
  // field's emptiness only becomes a problem because the OTHER field has
  // content. That is invisible from inside either input, so the parent says it.
  // Shown the instant the pair is half-filled, and it disappears the instant the
  // other half arrives — the alternative is the old behaviour, where a name with
  // no email looked accepted and was thrown away server-side.
  const pairGap = (mine: string, theirs: string, message: string): string | null =>
    !mine.trim() && theirs.trim() ? message : null;

  // Roles the volunteer is age-eligible for (others are shown disabled).
  const eligibility = useMemo(
    () =>
      new Map(
        roles.map((r) => [r.id, band ? bandMeetsMinAge(band, r.minAge) : true]),
      ),
    [roles, band],
  );

  const inputCls =
    "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";
  const labelCls = "block text-sm font-medium text-gray-700";

  function submit() {
    setError(null);
    if (!v.ageBand) {
      setError("Please choose your age group.");
      return;
    }
    if (!v.roleId) {
      setError("Please pick a role.");
      return;
    }
    // Pre-submit mirror of volunteerSignupSchema, so a half-filled counselor or
    // a bad link is caught here instead of coming back as a page-level throw.
    // Every rule below is the schema's own function or (for the email format)
    // deliberately looser than it — never stricter.
    const counselorProblem =
      counselorNameIssue(v.counselorName) ?? counselorEmailIssue(v.counselorEmail);
    if (counselorProblem) {
      setError(counselorProblem);
      return;
    }
    const urlProblem = hoursApprovalUrlIssue(v.hoursApprovalUrl);
    if (urlProblem) {
      setError(urlProblem);
      return;
    }
    startTransition(async () => {
      const res = await submitVolunteerSignup({
        name: v.name,
        email: v.email,
        phone: v.phone,
        ageBand: v.ageBand as VolunteerAgeBand,
        school: v.school || undefined,
        skills: v.skills || undefined,
        languages: v.languages || undefined,
        tshirtSize: v.tshirtSize || undefined,
        emergencyName: v.emergencyName || undefined,
        emergencyPhone: v.emergencyPhone || undefined,
        roleId: v.roleId,
        counselorName: v.counselorName || undefined,
        counselorEmail: v.counselorEmail || undefined,
        counselorTitle: v.counselorTitle || undefined,
        hoursApprovalUrl: v.hoursApprovalUrl || undefined,
        guardianName: v.guardianName || undefined,
        sourceTag: sourceTag || undefined,
      });
      if (res.ok) window.location.href = res.redirectUrl;
      else setError(res.error);
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Basics */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          About you
        </h2>
        <input
          className={inputCls}
          placeholder="Full name"
          value={v.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <input
          className={inputCls}
          type="email"
          placeholder="Email"
          value={v.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <input
          className={inputCls}
          type="tel"
          placeholder="Phone"
          value={v.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
        <div>
          <label className={labelCls}>Age group</label>
          <select
            className={`${inputCls} mt-1`}
            value={v.ageBand}
            onChange={(e) => set({ ageBand: e.target.value as VolunteerAgeBand })}
          >
            <option value="">Select…</option>
            {AGE_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            We only store your age band for role eligibility — never your date of
            birth.
          </p>
        </div>
      </section>

      {/* School + counselor */}
      <section className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">
          School & service hours
        </h2>
        <p className="text-xs text-gray-600">
          Volunteering for community-service hours? Tell us your school and the
          counselor / advisor you submit hours to. We&apos;ll have your verified
          hours ready for them — and we keep in touch with counselors about future
          opportunities for their students.
        </p>
        <div>
          <label className={labelCls}>
            School / organization{" "}
            <span className="text-gray-400">(optional)</span>
          </label>
          <input
            className={`${inputCls} mt-1`}
            placeholder="e.g. Edison High"
            value={v.school}
            onChange={(e) => set({ school: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>
            Counselor / advisor name{" "}
            {counselorRequired ? (
              <span className="text-red-600">*</span>
            ) : (
              <span className="text-gray-400">(optional)</span>
            )}
          </label>
          <ValidatedInput
            className={`${inputCls} mt-1`}
            placeholder="Who do you submit hours to?"
            aria-label="Counselor / advisor name"
            value={v.counselorName}
            onChange={(next) => set({ counselorName: next })}
            validate={counselorNameIssue}
            issue={pairGap(
              v.counselorName,
              v.counselorEmail,
              "Add the counselor / advisor name too — we can't record an approver from an email alone.",
            )}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              Counselor / advisor email{" "}
              {counselorRequired ? (
                <span className="text-red-600">*</span>
              ) : (
                <span className="text-gray-400">(optional)</span>
              )}
            </label>
            <ValidatedInput
              className={`${inputCls} mt-1`}
              type="email"
              inputMode="email"
              placeholder="advisor@school.edu"
              aria-label="Counselor / advisor email"
              value={v.counselorEmail}
              onChange={(next) => set({ counselorEmail: next })}
              validate={counselorEmailIssue}
              issue={pairGap(
                v.counselorEmail,
                v.counselorName,
                "Add a valid counselor / advisor email — a name on its own can't be saved.",
              )}
            />
          </div>
          <div>
            <label className={labelCls}>
              Their role <span className="text-gray-400">(optional)</span>
            </label>
            <input
              className={`${inputCls} mt-1`}
              placeholder="e.g. NHS Advisor"
              value={v.counselorTitle}
              onChange={(e) => set({ counselorTitle: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>
            Your school&apos;s hours-approval link{" "}
            <span className="text-gray-400">(optional)</span>
          </label>
          <ValidatedInput
            className={`${inputCls} mt-1`}
            placeholder="https://…"
            aria-label="School hours-approval link"
            value={v.hoursApprovalUrl}
            onChange={(next) => set({ hoursApprovalUrl: next })}
            validate={hoursApprovalUrlIssue}
          />
          <p className="mt-1 text-xs text-gray-500">
            If your school approves hours online, paste that link here and
            we&apos;ll use it — otherwise it gets lost in a text message. Must
            start with <span className="font-mono">https://</span>.
          </p>
        </div>
      </section>

      {/* Roles */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Pick a role
        </h2>
        {!band && (
          <p className="text-xs text-gray-500">
            Choose your age group above to see which roles you can sign up for.
          </p>
        )}
        {roles.map((r) => {
          const eligible = eligibility.get(r.id) ?? true;
          const disabled = r.isFull || !eligible;
          const selected = v.roleId === r.id;
          return (
            <label
              key={r.id}
              className={`flex min-h-tap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                disabled
                  ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                  : selected
                    ? "cursor-pointer border-brand bg-brand/5"
                    : "cursor-pointer border-gray-200"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {r.name}
                  {r.requiresClearance && (
                    <span className="ml-1 text-xs text-amber-700">
                      · training required
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {[
                    r.minAge > 0 ? `${r.minAge}+` : null,
                    r.shift,
                    r.description,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "All ages"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                {r.isFull ? (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600">
                    Full
                  </span>
                ) : !eligible ? (
                  <span className="text-gray-400">age</span>
                ) : (
                  <span>
                    {r.capacity > 0 ? `${r.filled}/${r.capacity}` : r.filled}
                  </span>
                )}
                <input
                  type="radio"
                  name="role"
                  className="h-5 w-5"
                  disabled={disabled}
                  checked={selected}
                  onChange={() => set({ roleId: r.id })}
                />
              </span>
            </label>
          );
        })}
      </section>

      {/* Minor consent */}
      {minor && (
        <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
            Parent / guardian consent
          </h2>
          <p className="text-xs text-amber-800">
            Volunteers under 18 need a parent or guardian to consent.
          </p>
          <input
            className={inputCls}
            placeholder="Parent / guardian full name"
            value={v.guardianName}
            onChange={(e) => set({ guardianName: e.target.value })}
          />
        </section>
      )}

      {/* Additional details */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          A few more details{" "}
          <span className="font-normal normal-case text-gray-400">(optional)</span>
        </h2>
        <input
          className={inputCls}
          placeholder="Skills (e.g. medical background, driving)"
          value={v.skills}
          onChange={(e) => set({ skills: e.target.value })}
        />
        <input
          className={inputCls}
          placeholder="Languages (e.g. Spanish, Hindi)"
          value={v.languages}
          onChange={(e) => set({ languages: e.target.value })}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className={inputCls}
            placeholder="Emergency contact name"
            value={v.emergencyName}
            onChange={(e) => set({ emergencyName: e.target.value })}
          />
          <input
            className={inputCls}
            type="tel"
            placeholder="Emergency contact phone"
            value={v.emergencyPhone}
            onChange={(e) => set({ emergencyPhone: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>T-shirt size</label>
          <select
            className={`${inputCls} mt-1`}
            value={v.tshirtSize}
            onChange={(e) => set({ tshirtSize: e.target.value })}
          >
            <option value="">Prefer not to say</option>
            {["XS", "S", "M", "L", "XL", "XXL"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Signing up…" : "Sign up to volunteer"}
        </button>
      </div>
    </div>
  );
}
