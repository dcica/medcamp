"use client";

import { useEffect, useRef, useState } from "react";
import {
  ValidatedInput,
  validateEmail,
  validateName,
  validatePhone,
} from "@/app/_components/ValidatedInput";
import { CheckoutReturnNotice } from "@/app/_components/CheckoutReturnNotice";
import { PERFORMANCE_AGE_BANDS } from "@/lib/performanceOptions";
import {
  clearDraft,
  hasEdits,
  loadDraft,
  saveDraft,
  snapshot,
  DRAFT_KEY,
} from "@/lib/checkoutDraft";
import { formatCents } from "@/lib/money";
import { submitPerformanceEntry } from "./actions";

/**
 * Phone-first competition entry form. One group, one song, one fee.
 *
 * Client validation here NEVER blocks and is never stricter than the server —
 * the invariant recorded in ValidatedInput.tsx. performanceEntrySchema and
 * createPerformanceEntry remain the only authority; these checks exist so an
 * entrant sees the group-size rule before paying rather than after.
 */

type Offering = {
  key: string;
  name: string;
  priceCents: number;
  isEarlyBird: boolean;
  earlyBirdUntil: string | null;
  minParticipants: number | null;
  maxParticipants: number | null;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
};

type Props = {
  eventId: string;
  eventName: string;
  entries: Offering[];
  uploadsAvailable: boolean;
  maxUploadMb: number;
  /** True when Stripe returned this entrant without payment (?cancelled=). */
  returnedFromCheckout: boolean;
  /** Set only when the server verified the resume cookie against that order. */
  resumable: { orderId: string; amountCents: number } | null;
};

/**
 * Everything the entrant typed, in one serialisable shape.
 *
 * This form has fifteen pieces of state and the longest fill in the product —
 * group, choreographer, head count, age band, song, running time, two yes/nos
 * and three contact fields. Losing it to a tap on Stripe's back link is the
 * defect this type exists to fix, so anything added to the form above belongs
 * in here too or it will silently stop surviving the round trip.
 */
type PerformDraft = {
  serviceKey: string;
  name: string;
  email: string;
  phone: string;
  groupName: string;
  choreographer: string;
  participants: string;
  ageRange: string;
  songTitle: string;
  mins: string;
  secs: string;
  usesProps: boolean | null;
  needsStagePrep: boolean | null;
  marketingConsent: boolean;
  wantsUpload: boolean;
};

function describeSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

export function PerformanceEntryForm({
  eventId,
  eventName,
  entries,
  uploadsAvailable,
  maxUploadMb,
  returnedFromCheckout,
  resumable,
}: Props) {
  const [serviceKey, setServiceKey] = useState(entries[0]?.key ?? "");
  const offering = entries.find((e) => e.key === serviceKey) ?? entries[0];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [groupName, setGroupName] = useState("");
  const [choreographer, setChoreographer] = useState("");
  const [participants, setParticipants] = useState("");
  const [ageRange, setAgeRange] = useState<string>("");
  const [songTitle, setSongTitle] = useState("");
  const [mins, setMins] = useState("");
  const [secs, setSecs] = useState("");
  const [usesProps, setUsesProps] = useState<boolean | null>(null);
  const [needsStagePrep, setNeedsStagePrep] = useState<boolean | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  // Default to uploading when it's possible; the server degrades this to OFFLINE
  // anyway if no storage provider is configured, so the two cannot disagree.
  const [wantsUpload, setWantsUpload] = useState(uploadsAvailable);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const values: PerformDraft = {
    serviceKey,
    name,
    email,
    phone,
    groupName,
    choreographer,
    participants,
    ageRange,
    songTitle,
    mins,
    secs,
    usesProps,
    needsStagePrep,
    marketingConsent,
    wantsUpload,
  };

  /**
   * Snapshot of the values as restored, so `dirty` below is a comparison rather
   * than fifteen hand-maintained onChange hooks. Anything the entrant changes
   * after landing here diverges from it; the restore itself does not.
   */
  const baseline = useRef<string | null>(null);
  const restored = useRef(false);

  /**
   * The draft is applied in an effect, NOT in a lazy useState initialiser.
   *
   * sessionStorage does not exist during server rendering, so a lazy
   * initialiser returns empty on the server and populated on the client — a
   * hydration mismatch, which React resolves by discarding one of them, and the
   * one it discards is not reliably the empty one. Correctness beats the single
   * frame of empty fields, on a page the buyer has just navigated to from
   * another origin anyway.
   */
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    if (!returnedFromCheckout) {
      // A fresh visit starts fresh. Without this, a draft left over from a
      // completed purchase would refill the form the next time someone entered
      // a second group from the same tab.
      clearDraft(DRAFT_KEY.perform);
      return;
    }

    const draft = loadDraft<PerformDraft>(DRAFT_KEY.perform, eventId);
    if (!draft) {
      // No draft, but possibly still a resumable order — that is the tab-loss
      // case the resume cookie exists for. The baseline must be set ANYWAY, or
      // `dirty` below can never become true and the resume button would go on
      // offering the old order's total under a form they have since filled in
      // from scratch.
      baseline.current = snapshot(values);
      return;
    }

    const v = draft.values;
    const applied: PerformDraft = {
      ...v,
      // Preserved as a tri-state. `null` means "skipped the question", which a
      // coordinator planning stage changeovers reads differently from "No" —
      // see the YesNo comment below. `?? null`, never `?? false`.
      usesProps: v.usesProps ?? null,
      needsStagePrep: v.needsStagePrep ?? null,
      // Uploads may have been switched off since they typed this.
      wantsUpload: v.wantsUpload && uploadsAvailable,
    };

    setServiceKey(applied.serviceKey);
    setName(applied.name);
    setEmail(applied.email);
    setPhone(applied.phone);
    setGroupName(applied.groupName);
    setChoreographer(applied.choreographer);
    setParticipants(applied.participants);
    setAgeRange(applied.ageRange);
    setSongTitle(applied.songTitle);
    setMins(applied.mins);
    setSecs(applied.secs);
    setUsesProps(applied.usesProps);
    setNeedsStagePrep(applied.needsStagePrep);
    setMarketingConsent(applied.marketingConsent);
    setWantsUpload(applied.wantsUpload);
    // The APPLIED values, not the raw draft: if a coercion above changed
    // anything, comparing against the raw draft would read as an edit the
    // entrant never made and would retract the resume button on arrival.
    baseline.current = snapshot(applied);
    // `values` is read once, on mount, and the effect is guarded by
    // `restored` — it must not re-run when the entrant types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedFromCheckout, eventId, uploadsAvailable]);

  /**
   * Has the entrant changed anything since landing back here? Drives whether
   * the resume button survives — see CheckoutReturnNotice for why editing the
   * form must retract an offer to pay the old order's total.
   */
  const dirty = hasEdits(baseline.current, values);

  const durationSeconds =
    mins.trim() === "" && secs.trim() === ""
      ? undefined
      : (Number(mins || 0) || 0) * 60 + (Number(secs || 0) || 0);

  /**
   * Mirrors the server's participant bounds exactly — never tighter. An empty
   * field stays quiet: "required" is the submit path's job, not a nag at
   * someone who hasn't reached the field yet.
   */
  function validateParticipants(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n)) return "Enter a whole number of participants.";
    if (n < 1) return "Enter the number of participants.";
    if (offering?.minParticipants !== null && offering?.minParticipants !== undefined && n < offering.minParticipants) {
      return `This event needs at least ${offering.minParticipants} in a group.`;
    }
    if (offering?.maxParticipants !== null && offering?.maxParticipants !== undefined && n > offering.maxParticipants) {
      return `This event allows at most ${offering.maxParticipants} in a group.`;
    }
    return null;
  }

  function durationIssue(): string | null {
    if (durationSeconds === undefined || !offering) return null;
    if (offering.minDurationSeconds !== null && durationSeconds < offering.minDurationSeconds) {
      return `The performance must be at least ${describeSeconds(offering.minDurationSeconds)}.`;
    }
    if (offering.maxDurationSeconds !== null && durationSeconds > offering.maxDurationSeconds) {
      return `The performance must be no longer than ${describeSeconds(offering.maxDurationSeconds)}.`;
    }
    return null;
  }

  /**
   * Pre-flight before the network hop. Every rule here MIRRORS
   * performanceEntrySchema / createPerformanceEntry and is never stricter — the
   * invariant recorded in ValidatedInput.tsx. A client check tighter than the
   * server turns away an entrant with a perfectly good answer, and on the night
   * before a deadline there is no recovery path.
   *
   * Its only job is to save a round trip: without it, a blank age group meant
   * submitting, waiting, and being told to go back. The server still decides.
   */
  function preflight(): string | null {
    if (!groupName.trim()) return "Group name is required.";
    if (!choreographer.trim()) return "Choreographer's name is required.";
    if (!participants.trim()) return "Enter the number of participants.";
    const participantIssue = validateParticipants(participants);
    if (participantIssue) return participantIssue;
    if (!ageRange) return "Pick an age group.";
    if (!songTitle.trim()) return "Song name is required.";
    const dIssue = durationIssue();
    if (dIssue) return dIssue;
    if (!name.trim()) return "Your name is required.";
    // Weaker than the server's z.string().email() on purpose: presence only.
    if (!email.trim()) return "Email is required — your confirmation goes there.";
    if (phone.trim().length < 7) return "Phone is required.";
    return null;
  }

  async function onSubmit() {
    setError(null);
    const problem = preflight();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    const result = await submitPerformanceEntry({
      eventId,
      serviceKey,
      registrant: { name, email, phone },
      marketingConsent,
      groupName,
      choreographerName: choreographer,
      participantCount: Number(participants),
      ageRange,
      songTitle,
      songDelivery: wantsUpload ? "UPLOAD" : "OFFLINE",
      durationSeconds,
      usesProps: usesProps ?? undefined,
      needsStagePrep: needsStagePrep ?? undefined,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    // Written immediately before the hop, because that hop is a full document
    // navigation to another origin — every useState above is about to cease to
    // exist. Keyed to the order just created so the return page can tell this
    // draft from a stale one.
    saveDraft<PerformDraft>(DRAFT_KEY.perform, {
      eventId,
      orderId: result.orderId,
      values,
    });
    window.location.href = result.redirectUrl;
  }

  if (!offering) {
    return (
      <p className="mt-6 text-sm text-gray-600">
        No entry fee is set up for {eventName} yet.
      </p>
    );
  }

  const sizeHint =
    offering.minParticipants !== null && offering.maxParticipants !== null
      ? `${offering.minParticipants}–${offering.maxParticipants} participants`
      : null;
  const durationHint =
    offering.minDurationSeconds !== null && offering.maxDurationSeconds !== null
      ? `${describeSeconds(offering.minDurationSeconds)}–${describeSeconds(offering.maxDurationSeconds)}`
      : null;

  return (
    <div className="mt-6 space-y-6">
      {returnedFromCheckout && (
        <CheckoutReturnNotice
          resumable={resumable}
          dirty={dirty}
          routes={{
            successPath: resumable
              ? `/perform/after-payment/${resumable.orderId}`
              : undefined,
            cancelPath: "/perform",
          }}
        />
      )}

      {entries.length > 1 && (
        <Section title="Which category">
          <div className="space-y-2">
            {entries.map((e) => (
              <label
                key={e.key}
                className="flex min-h-tap items-center gap-3 rounded-lg border border-gray-300 px-4"
              >
                <input
                  type="radio"
                  name="category"
                  checked={serviceKey === e.key}
                  onChange={() => setServiceKey(e.key)}
                  className="h-5 w-5"
                />
                <span className="flex-1 text-sm font-medium">{e.name}</span>
                <span className="text-sm text-gray-600">
                  {formatCents(e.priceCents)}
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <Section title="Your group">
        <Field label="Group name">
          <ValidatedInput
            value={groupName}
            onChange={setGroupName}
            validate={validateName}
            // Deliberately not a plausible real group name: "DCICA-Shakti"
            // is the org's own branding on two live events, so an example like
            // "Shakti Steps" read as a real entrant rather than a hint.
            placeholder="Your group's name"
            aria-label="Group name"
          />
        </Field>
        <Field label="Choreographer's name">
          <ValidatedInput
            value={choreographer}
            onChange={setChoreographer}
            validate={validateName}
            aria-label="Choreographer's name"
          />
        </Field>
        <Field
          label="Number of participants"
          hint={sizeHint ?? undefined}
        >
          <ValidatedInput
            value={participants}
            onChange={setParticipants}
            validate={validateParticipants}
            inputMode="numeric"
            placeholder={sizeHint ? String(offering.minParticipants) : "6"}
            aria-label="Number of participants"
          />
        </Field>
        <Field label="Age group">
          <select
            value={ageRange}
            onChange={(e) => setAgeRange(e.target.value)}
            aria-label="Age group"
            className="min-h-tap w-full rounded-lg border border-gray-300 px-3 text-sm"
          >
            <option value="">Choose…</option>
            {PERFORMANCE_AGE_BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Your performance">
        <Field label="Song name">
          <ValidatedInput
            value={songTitle}
            onChange={setSongTitle}
            validate={validateName}
            placeholder="Song title"
            aria-label="Song name"
          />
        </Field>
        <Field
          label="How long is the performance?"
          hint={durationHint ? `Allowed: ${durationHint}` : undefined}
          issue={durationIssue()}
        >
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="sr-only">Minutes</span>
              <input
                value={mins}
                onChange={(e) => setMins(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="5"
                aria-label="Minutes"
                className="min-h-tap w-full rounded-lg border border-gray-300 px-3 text-sm"
              />
            </label>
            <span className="self-center text-sm text-gray-500">min</span>
            <label className="flex-1">
              <span className="sr-only">Seconds</span>
              <input
                value={secs}
                onChange={(e) => setSecs(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="30"
                aria-label="Seconds"
                className="min-h-tap w-full rounded-lg border border-gray-300 px-3 text-sm"
              />
            </label>
            <span className="self-center text-sm text-gray-500">sec</span>
          </div>
        </Field>
        <YesNo
          label="Using props?"
          value={usesProps}
          onChange={setUsesProps}
        />
        <YesNo
          label="Need stage setup time before you start?"
          value={needsStagePrep}
          onChange={setNeedsStagePrep}
        />
      </Section>

      <Section title="Your music">
        <div className="space-y-2">
          <label className="flex min-h-tap items-center gap-3 rounded-lg border border-gray-300 px-4">
            <input
              type="radio"
              name="delivery"
              checked={wantsUpload}
              disabled={!uploadsAvailable}
              onChange={() => setWantsUpload(true)}
              className="h-5 w-5"
            />
            <span className="flex-1 text-sm">
              I&apos;ll upload an MP3 after paying
              <span className="block text-xs text-gray-500">
                Up to {maxUploadMb} MB, from the link on your confirmation
              </span>
            </span>
          </label>
          <label className="flex min-h-tap items-center gap-3 rounded-lg border border-gray-300 px-4">
            <input
              type="radio"
              name="delivery"
              checked={!wantsUpload}
              onChange={() => setWantsUpload(false)}
              className="h-5 w-5"
            />
            <span className="flex-1 text-sm">
              Contact me — I&apos;ll send it another way
            </span>
          </label>
        </div>
        {!uploadsAvailable && (
          <p className="mt-2 text-xs text-amber-800">
            File upload isn&apos;t available right now, so an organizer will
            contact you about your track.
          </p>
        )}
      </Section>

      <Section title="Your contact details">
        <p className="text-xs text-gray-500">
          Where we send your confirmation and your music-upload link.
        </p>
        <Field label="Your name">
          <ValidatedInput
            value={name}
            onChange={setName}
            validate={validateName}
            autoComplete="name"
            aria-label="Your name"
          />
        </Field>
        <Field label="Email">
          <ValidatedInput
            value={email}
            onChange={setEmail}
            validate={validateEmail}
            type="email"
            autoComplete="email"
            aria-label="Email"
          />
        </Field>
        <Field label="Phone">
          <ValidatedInput
            value={phone}
            onChange={setPhone}
            validate={validatePhone}
            type="tel"
            autoComplete="tel"
            aria-label="Phone"
          />
        </Field>
        <label className="mt-2 flex items-start gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5"
          />
          <span>Email me about future DCICA events.</span>
        </label>
      </Section>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-600">Entry fee</span>
          <span className="text-xl font-bold">
            {formatCents(offering.priceCents)}
          </span>
        </div>
        {offering.isEarlyBird && offering.earlyBirdUntil && (
          <p className="mt-1 text-xs font-medium text-green-700">
            Early bird price — until{" "}
            {new Date(offering.earlyBirdUntil).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Per group, not per dancer. Non-refundable.
        </p>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="mt-4 flex min-h-tap w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-50"
        >
          {submitting ? "Taking you to payment…" : "Pay and enter"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  issue,
  children,
}: {
  label: string;
  hint?: string;
  issue?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      <div className="mt-1">{children}</div>
      {issue && <p className="mt-1 text-xs text-red-700">{issue}</p>}
    </div>
  );
}

/**
 * Three-state on purpose: null means "not answered", which is distinct from
 * "No". A coordinator planning stage changeovers needs to know the difference
 * between a group that said no props and a group that skipped the question.
 */
function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <div className="mt-1 flex gap-3">
        {[
          { text: "Yes", v: true },
          { text: "No", v: false },
        ].map((opt) => (
          <button
            key={opt.text}
            type="button"
            onClick={() => onChange(opt.v)}
            aria-pressed={value === opt.v}
            className={`flex min-h-tap flex-1 items-center justify-center rounded-lg border px-4 text-sm font-medium ${
              value === opt.v
                ? "border-brand bg-brand text-brand-fg"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}
