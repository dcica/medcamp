/**
 * Volunteer signup code: VOL-<eventCode>-NNNN (e.g. VOL-MC-2026W-0231).
 * Encoded in the day-of QR; NNNN is a per-event sequence (Event.nextVolSeq).
 * Mirrors src/lib/campId.ts so the scanner/manual-entry flow normalizes the same
 * way for volunteers as it does for patients.
 */
export function formatVolCode(eventCode: string, sequence: number): string {
  return `VOL-${eventCode}-${sequence.toString().padStart(4, "0")}`;
}

const VOL_CODE_RE = /^VOL-([A-Z]{2,4}-\d{4}[SW])-(\d{4})$/;

export function parseVolCode(
  code: string,
): { eventCode: string; sequence: number } | null {
  const m = code.trim().toUpperCase().match(VOL_CODE_RE);
  if (!m) return null;
  return { eventCode: m[1], sequence: Number(m[2]) };
}

/** Normalize a scanned/typed code to canonical form, or null if unparseable. */
export function normalizeVolCode(code: string): string | null {
  const parsed = parseVolCode(code);
  return parsed ? formatVolCode(parsed.eventCode, parsed.sequence) : null;
}
