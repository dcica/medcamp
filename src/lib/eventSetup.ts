/**
 * Field rules for the event setup form — the single copy of each, shared by the
 * field that shows the message and the server action that enforces it.
 *
 * WHY IT IS ONE FUNCTION AND NOT TWO. `ValidatedInput` records the invariant:
 * "no check here may reject anything the server accepts", because a client
 * validator stricter than the server turns a coordinator away with no
 * explanation. The cheapest way to hold that invariant is to have exactly one
 * rule, called from both sides, rather than two that must be kept
 * character-for-character identical by hand.
 *
 * THE DISTINCTION THAT MATTERS: blank is not zero. Blank means "this venue has
 * no stated limit" and must reach the database as NULL, where the gate shows a
 * plain admitted headcount and no fill bar. Zero means the bar reads "312 of 0"
 * and the door is told to stop admitting people who are already inside, so the
 * database refuses it outright (CHECK "events_venueCapacity_positive"). If this
 * parser ever let a blank field through as 0, the coordinator would meet that
 * constraint as an unexplained failure to save.
 */

/** Postgres INTEGER ceiling. Above this the column itself would throw. */
const INT4_MAX = 2147483647;

export type VenueCapacityParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function parseVenueCapacity(raw: string): VenueCapacityParse {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  // Digits only, deliberately: "400 people", "4,00" and "-1" are all things a
  // person types, and Number() would quietly turn some of them into a number
  // that is not what they meant.
  if (!/^\d+$/.test(v)) {
    return { ok: false, error: "Floor capacity must be a whole number." };
  }
  const n = Number(v);
  if (n === 0) {
    return {
      ok: false,
      error: "Floor capacity must be at least 1 — leave it blank if there is no limit.",
    };
  }
  if (n > INT4_MAX) {
    return { ok: false, error: "That floor capacity is too large." };
  }
  return { ok: true, value: n };
}

/** Field-side wrapper: the message when it is wrong, null when it is fine. */
export function validateVenueCapacity(value: string): string | null {
  const parsed = parseVenueCapacity(value);
  return parsed.ok ? null : parsed.error;
}

// ── Coordinator notes about the event ────────────────────────────────────────

/**
 * Length ceiling for `Event.internalNotes`. Roughly a screen and a half of
 * logistics — load-in, the sound desk's number, who has the key — and short of
 * anything that could quietly become a second roster.
 *
 * The ceiling is a No-PHI measure, not a storage one. Events are never purged:
 * `purgedAt` erases attendee PII and leaves the event row standing, so anything
 * about a person typed in this box outlives the deletion meant to remove it. A
 * box that cannot hold a list is one fewer place for that list to appear.
 */
export const INTERNAL_NOTES_MAX = 2000;

export type InternalNotesParse =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Blank becomes NULL rather than "", so "no notes" is one value and not two —
 * the same reason `location` is cleared to null a few lines up in updateCamp.
 */
export function parseInternalNotes(raw: string): InternalNotesParse {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  if (v.length > INTERNAL_NOTES_MAX) {
    return {
      ok: false,
      error: `Keep notes under ${INTERNAL_NOTES_MAX} characters — this is a note field, not a record.`,
    };
  }
  return { ok: true, value: v };
}

/** Field-side wrapper. Identical rule; see the invariant in ValidatedInput. */
export function validateInternalNotes(value: string): string | null {
  const parsed = parseInternalNotes(value);
  return parsed.ok ? null : parsed.error;
}
