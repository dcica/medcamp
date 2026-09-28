import type { ScanTone } from "./scanVerdict";

/**
 * How the three scan tones LOOK, in one place.
 *
 * `src/lib/scanVerdict.ts` decides which tone an outcome earns and
 * `src/lib/scanTones.ts` decides how it sounds. This is the third channel:
 * how it is painted and what it is called.
 *
 * WHY THESE LIVE TOGETHER. They used to sit inside ScanVerdictBanner.tsx
 * because the banner was the only thing that drew a verdict. The gate now
 * draws it around the camera instead, and the moment two screens each held
 * their own table there was a way for a green band to appear over an amber
 * headline. One table, imported, is the only arrangement that cannot drift.
 *
 * THESE ARE NOT TENANT COLOURS and must never be routed through the theme.
 * Green=go / amber=hold / red=stop is a convention a volunteer reads at a
 * door, in gym lighting, under time pressure — it is meaning, not identity.
 * `scripts/verify-branding.ts` §8 enforces the separation.
 */

/** The band AROUND the scan surface — [ x { y } x ]. */
export const TONE_BAND: Record<ScanTone | "idle", string> = {
  go: "bg-green-600",
  hold: "bg-amber-400",
  stop: "bg-red-600",
  // Idle is deliberately neutral: "no answer yet" must not look like an
  // answer. This is the same mistake html5-qrcode's own green makes, which
  // globals.css exists to suppress.
  idle: "bg-gray-200",
};

/**
 * The tone as a WORD.
 *
 * Colour fails in a bright doorway and for the ~1 in 12 men with a red-green
 * deficiency; the glyph fails on a cracked or filthy screen. Three words of
 * plain English fail in neither, and they are what a volunteer says out loud
 * to the person behind them in the queue.
 */
export const TONE_WORD: Record<ScanTone, string> = {
  go: "LET IN",
  hold: "STOP · ASK",
  stop: "DO NOT ADMIT",
};
