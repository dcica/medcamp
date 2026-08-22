/**
 * Duplicate-decode suppression for the continuous camera at the gate.
 *
 * A live camera re-decodes the same QR ten times a second for as long as it
 * stays in frame. Without suppression, one guest holding up one phone fires one
 * server round trip per frame and the screen flickers between resolutions of the
 * same person. The window is what makes "keep the camera up and scan person
 * after person" usable.
 *
 * 3 seconds is the interval between two people at a door — long enough that a
 * badge lingering in frame is silent, short enough that a volunteer who
 * genuinely re-scans the same ticket (checking a hand-over, say) is not left
 * tapping at a dead camera.
 *
 * Only the LAST decode is remembered, deliberately: A → B → A inside the window
 * fires three times, because the second A is a real second look at that guest,
 * not the same badge sitting in frame.
 *
 * Extracted from `QrScanner` so the rule can be tested without a camera — the
 * behaviour is invisible in any design mock and survives the gate's redesign.
 */
export const DUPLICATE_SCAN_WINDOW_MS = 3000;

export type LastDecode = { text: string; at: number };

/** True when this decode is the previous one still sitting in frame. */
export function isDuplicateDecode(
  last: LastDecode,
  decoded: string,
  now: number,
): boolean {
  return decoded === last.text && now - last.at < DUPLICATE_SCAN_WINDOW_MS;
}
