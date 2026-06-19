/**
 * Auto-assigned station colors (Care Spine palette from docs/Design-System.md).
 * Admins never pick a station color — it's derived from the station key, falling
 * back to a palette cycled by sequence. Used at station-create time and as the
 * render fallback when Station.colorHex is null.
 */
const KNOWN: Record<string, string> = {
  checkin: "#5A6663",
  vitals: "#4F5E7D",
  consult: "#157A42",
  doctor: "#157A42",
  blood: "#C8323B",
  bloodwork: "#C8323B",
  labs: "#2563B0",
  ultrasound: "#2563B0",
  xray: "#6D4AA8",
  ekg: "#0B7E7C",
  shots: "#BC3F84",
};

const PALETTE = [
  "#4F5E7D",
  "#157A42",
  "#C8323B",
  "#2563B0",
  "#6D4AA8",
  "#0B7E7C",
  "#BC3F84",
];

export function autoStationColor(key: string, sequence: number): string {
  return KNOWN[key.toLowerCase()] ?? PALETTE[sequence % PALETTE.length];
}
