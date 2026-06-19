/**
 * Camp ID format: MC-YYYY[S|W]-NNNN (e.g. MC-2026W-0042).
 * The prefix (MC-2026W) is the Event.code; NNNN is a per-event sequence.
 */
export function formatCampId(eventCode: string, sequence: number): string {
  return `${eventCode}-${sequence.toString().padStart(4, "0")}`;
}

const CAMP_ID_RE = /^([A-Z]{2,4}-\d{4}[SW])-(\d{4})$/;

export function parseCampId(
  campId: string,
): { eventCode: string; sequence: number } | null {
  const m = campId.trim().toUpperCase().match(CAMP_ID_RE);
  if (!m) return null;
  return { eventCode: m[1], sequence: Number(m[2]) };
}
