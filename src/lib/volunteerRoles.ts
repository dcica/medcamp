import type { VolunteerAgeBand } from "@prisma/client";

/**
 * Shared volunteer reference data (age bands + outreach source tags), used by the
 * public signup form, the coordinator dashboard, and CSV exports. Mirrors the
 * prototype in docs/demo/assets/data.js. Age gating is for task suitability and
 * supervision — volunteers never perform clinical work regardless of age.
 */

export const AGE_BANDS: {
  value: VolunteerAgeBand;
  label: string;
  /** Lower bound in years — used to gate roles by VolunteerRole.minAge. */
  minAge: number;
  rank: number;
}[] = [
  { value: "UNDER_16", label: "Under 16 · middle school", minAge: 0, rank: 0 },
  { value: "AGE_16_17", label: "16–17 · high school", minAge: 16, rank: 1 },
  { value: "AGE_18_PLUS", label: "18 or older · college / adult", minAge: 18, rank: 2 },
];

export function ageBandLabel(band: VolunteerAgeBand | null | undefined): string {
  return AGE_BANDS.find((b) => b.value === band)?.label ?? "—";
}

/** Lower-bound age for a band (for role eligibility checks). */
export function ageBandMinYears(band: VolunteerAgeBand): number {
  return AGE_BANDS.find((b) => b.value === band)?.minAge ?? 0;
}

/** A volunteer in `band` is eligible for a role requiring `minAge` years. */
export function bandMeetsMinAge(band: VolunteerAgeBand, minAge: number): boolean {
  // Under-16 band can't satisfy a 16+ or 18+ gate; 16–17 can't satisfy 18+.
  if (minAge <= 0) return true;
  if (minAge >= 18) return band === "AGE_18_PLUS";
  if (minAge >= 16) return band !== "UNDER_16";
  return true;
}

/** Minors (under 18) require parent/guardian consent at signup. */
export function isMinorBand(band: VolunteerAgeBand): boolean {
  return band === "UNDER_16" || band === "AGE_16_17";
}

export const SOURCE_TAGS: { tag: string; label: string }[] = [
  { tag: "school", label: "School" },
  { tag: "past", label: "Past volunteers" },
  { tag: "social", label: "Social media" },
  { tag: "org", label: "Community orgs" },
];

export function sourceLabel(tag: string | null | undefined): string {
  return SOURCE_TAGS.find((s) => s.tag === tag)?.label ?? "Direct";
}

/** Normalize an arbitrary ?src= value to a known tag, or null. */
export function normalizeSourceTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return SOURCE_TAGS.some((s) => s.tag === v) ? v : null;
}

// ── Counselor pair + hours-approval link ─────────────────────────────────────
//
// WHY these rules live here instead of being written twice: the signup form is a
// client component and `volunteerSignupSchema` (src/server/volunteers.ts) is the
// only real gate. On this codebase a CLIENT check that is STRICTER than the
// server costs a real signup with no recovery path, so both sides call the SAME
// function — identical by construction rather than by review. When a rule moves,
// it moves here once.

/** Non-whitespace content. `"   "` is empty: `min(1)` counts a space (G5). */
export function hasContent(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Is the counselor name+email pair required, and why.
 *
 * WHY all-or-nothing: `Counselor.email` is non-null and is the per-org dedupe
 * key (`@@unique([orgId, email])`), so a name with no email CANNOT be stored.
 * Before this rule such a name passed validation and was then silently dropped
 * by the persist branch — the volunteer believed they had told us who approves
 * their hours and we kept nothing. Requiring the pair is what makes the drop
 * impossible instead of invisible.
 *
 * Two independent triggers, and the older one is the stricter one:
 *   "student"  — a school was given, or the volunteer is a minor. Both fields
 *                required even when the volunteer typed neither.
 *   "pairwise" — anyone who filled in EITHER field now owes the other.
 */
export function counselorPairRequired(input: {
  school?: string | null;
  ageBand: VolunteerAgeBand | null;
  counselorName?: string | null;
  counselorEmail?: string | null;
}): { required: boolean; reason: "student" | "pairwise" | null } {
  const student =
    hasContent(input.school) ||
    (input.ageBand ? isMinorBand(input.ageBand) : false);
  if (student) return { required: true, reason: "student" };
  const pairwise =
    hasContent(input.counselorName) || hasContent(input.counselorEmail);
  return pairwise
    ? { required: true, reason: "pairwise" }
    : { required: false, reason: null };
}

/**
 * Ceiling for the school's hours-approval link. Generous because these URLs
 * carry session/assignment tokens (x2VOL, Naviance, district forms), but bounded
 * so a paste accident cannot become an unbounded column write.
 */
export const HOURS_APPROVAL_URL_MAX = 1000;

/**
 * The school's hours-approval link: optional, and when present it must be an
 * absolute `https:` URL.
 *
 * WHY https-only, and WHY it is never fetched: this is untrusted text a stranger
 * typed into a public form, and it ends up as a link on a coordinator's screen.
 * `javascript:` and `data:` would execute in her session; plain `http:` would
 * leak an approval token in transit. And nothing server-side may ever open it —
 * an attacker-chosen URL fetched by our server is an SSRF hole (cloud metadata,
 * internal hosts). It is stored as text, rendered with rel="noopener noreferrer",
 * and clicked by a human or not at all.
 *
 * Returns a human-readable message when unacceptable, or null when fine. Called
 * unchanged by both the form and the schema.
 */
export function hoursApprovalUrlIssue(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null; // optional
  if (v.length > HOURS_APPROVAL_URL_MAX) {
    return `That link is too long (max ${HOURS_APPROVAL_URL_MAX} characters).`;
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return "That doesn't look like a link — paste the full address, starting with https://";
  }
  if (parsed.protocol !== "https:") {
    return "The link must start with https:// — we can't accept other kinds of links.";
  }
  return null;
}
