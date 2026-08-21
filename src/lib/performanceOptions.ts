/**
 * Controlled vocabularies for competition / showcase entry.
 *
 * These exist because the Google Forms being replaced left "Other:" enabled on
 * every choice question, so one age-group question came back as "Mixed", "mixed
 * ages", "10 to 40" and "all" — four spellings of two different answers, in a
 * field a coordinator has to group performances by.
 *
 * PROVISIONAL, and deliberately not per-event yet. Both live events want the
 * same bands, so a shared list is honest; when a third event wants different
 * ones, this moves to per-event config beside the participant/duration rules on
 * ServiceCap rather than growing conditionals here.
 */

/**
 * Age bands. NON-OVERLAPPING on purpose: the Diwali form offered "12-17 years"
 * AND "17+ years", so a 17-year-old's group matched two bands and the answer
 * depended on which the choreographer happened to tap. Judging by age group
 * cannot survive that, so 17 belongs to exactly one band here.
 */
export const PERFORMANCE_AGE_BANDS = [
  "7–11 years",
  "12–16 years",
  "17+ years",
  "Mixed ages",
] as const;

export type PerformanceAgeBand = (typeof PERFORMANCE_AGE_BANDS)[number];

/** Whether a submitted band is one we offered. Server-side guard. */
export function isKnownAgeBand(value: string): boolean {
  return (PERFORMANCE_AGE_BANDS as readonly string[]).includes(value);
}
