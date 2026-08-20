import { generateIdToken, normalizePublicId } from "@/lib/publicId";

/**
 * Ticket id format: <eventCode>-<token> (e.g. GARBA-2026-K7M2XQ9T).
 *
 * The prefix is the Event.code and stays readable — a volunteer glancing at a
 * badge should be able to tell a Garba entry from a Dandiya one without
 * scanning, and the event is public information anyway. The suffix is a random
 * token; see src/lib/publicId.ts for why it is no longer a sequence.
 *
 * Historic ids from the sequential scheme (GARBA-2026-0001, MC-2026W-0042) are
 * still valid and still resolve — those tickets are already in people's hands.
 * Nothing here rewrites them; they are simply matched as-is.
 */
export function formatCampId(eventCode: string, token: string): string {
  return `${eventCode}-${token}`;
}

/** A complete ticket id for an event, with a freshly generated token. */
export function newCampId(eventCode: string): string {
  return formatCampId(eventCode, generateIdToken());
}

/**
 * Canonicalize a scanned or typed ticket id for lookup.
 *
 * Returns a string rather than a parsed structure. The old `parseCampId`
 * returned `{eventCode, sequence}` and existed to zero-pad a typed short form,
 * which a random token has no equivalent of. It was also quietly broken: its
 * regex required a 2-4 letter code with an S/W season suffix, so every id for
 * the current event lineup failed to parse and fell through to a raw match.
 */
export function normalizeCampId(raw: string): string {
  return normalizePublicId(raw);
}
