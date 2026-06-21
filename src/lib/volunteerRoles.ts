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
