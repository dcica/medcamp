import { generateIdToken, normalizePublicId } from "@/lib/publicId";

/**
 * Volunteer signup code: VOL-<eventCode>-<token> (e.g. VOL-GARBA-2026-4PW9HB2N).
 * Encoded in the day-of QR for sign in/out.
 *
 * Mirrors src/lib/campId.ts deliberately, so the scanner and manual-entry flow
 * normalize the same way for volunteers as for ticket holders — one convention,
 * not two. Was a per-event sequence (Event.nextVolSeq); that leaked headcount
 * the same way ticket sequences leaked sales.
 */
export function formatVolCode(eventCode: string, token: string): string {
  return `VOL-${eventCode}-${token}`;
}

/** A complete volunteer code for an event, with a freshly generated token. */
export function newVolCode(eventCode: string): string {
  return formatVolCode(eventCode, generateIdToken());
}

/**
 * Canonicalize a scanned or typed volunteer code for lookup. Legacy sequential
 * codes (VOL-MC-2026W-0231) still resolve — the token is the final segment in
 * both schemes, and digits are untouched by the confusable mapping.
 */
export function normalizeVolCode(raw: string): string {
  return normalizePublicId(raw);
}
