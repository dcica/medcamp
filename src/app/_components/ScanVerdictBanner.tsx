import type { ScanTone, ScanVerdict } from "@/lib/scanVerdict";

/**
 * What the last scan meant, said once, loudly.
 *
 * Replaces a 32px tinted strip that sat BELOW the camera and the manual-entry
 * box — so a tall guest card could push it off screen — and that was set to
 * null on success, meaning a successful scan produced no message at all.
 *
 * This is dumb on purpose: it takes a ScanVerdict and renders it. It never
 * decides a tone. src/lib/scanVerdict.ts owns that, and verify-scan pins it.
 */

/**
 * Solid fills, not tints. A 50-weight background reads as white in daylight on
 * a phone at minimum brightness, which is the actual lighting at a door.
 *
 * `hold` is dark ink on amber rather than white: amber-400 with white text
 * fails contrast, and dark-on-amber is the same treatment the fee block already
 * uses (#a86800 on #fff7e6) for the other "look before you act" state.
 *
 * These are STATUS colours, deliberately outside the tenant theme — green=OPEN,
 * amber=CLOSED, red=problem is a convention a volunteer reads under time
 * pressure, and a brand-red "admitted" chip would read as a safety signal.
 * CLAUDE.md states the rule; verify-branding §8 enforces it.
 */
const TONE_STYLE: Record<ScanTone, string> = {
  go: "bg-green-600 text-white",
  hold: "bg-amber-400 text-[#16201f]",
  stop: "bg-red-600 text-white",
};

/**
 * The same three tones, as a frame around the camera.
 *
 * WHY THE CAMERA IS TINTED AT ALL, given globals.css spends twenty lines
 * killing html5-qrcode's own green. That green fires on mere PARSEABILITY —
 * before any lookup, identically for a valid ticket and a Wi-Fi QR on the wall
 * — so it is a lie and stays suppressed. This is the opposite: it is painted
 * only once the SERVER has answered, from the same tone the banner uses.
 *
 * It lives next to TONE_STYLE, and is exported rather than re-typed at the
 * call site, because two independent colour tables for one meaning is exactly
 * how a green frame ends up over an amber banner.
 *
 * `null` is the idle frame — deliberately a neutral, so "no answer yet" never
 * looks like an answer.
 */
export const TONE_FRAME: Record<ScanTone | "idle", string> = {
  go: "border-green-600",
  hold: "border-amber-400",
  stop: "border-red-600",
  idle: "border-gray-200",
};

export function ScanVerdictBanner({
  verdict,
  onRelease,
  nudge,
}: {
  verdict: ScanVerdict;
  /**
   * "Next guest". The ONLY way out of a standing verdict — see
   * src/lib/scanLatch.ts for why an incoming scan must not be another one.
   */
  onRelease: () => void;
  /** Set when a scan arrived and was deliberately ignored. */
  nudge?: boolean;
}) {
  return (
    <div
      // aria-live assertive: a volunteer using a screen reader at a door needs
      // this now, not after whatever else is being announced.
      role="status"
      aria-live="assertive"
      className={`rounded-xl px-4 py-3 ${TONE_STYLE[verdict.tone]}`}
    >
      <div className="flex items-start gap-3">
        {/* The glyph carries the verdict where colour cannot: red-green
            deficiency, greyscale, a screenshot pasted into a group chat. */}
        <span aria-hidden className="text-3xl font-bold leading-none">
          {verdict.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-extrabold uppercase leading-tight">
            {verdict.headline}
          </p>
          {verdict.detail && (
            <p className="mt-0.5 break-words text-base leading-snug opacity-95">
              {verdict.detail}
            </p>
          )}
          {verdict.instruction && (
            <p className="mt-1 text-sm font-semibold leading-snug">
              {verdict.instruction}
            </p>
          )}
        </div>
      </div>

      {nudge && (
        // A scan that silently does nothing is a new confusion. Say so — and
        // note this is the one event that deliberately makes NO sound.
        <p className="mt-2 rounded-lg bg-black/15 px-3 py-2 text-sm font-semibold">
          Another code was scanned and ignored — finish this guest first.
        </p>
      )}

      {/* NO AUTO-DISMISS. For the two seconds after a scan the volunteer is
          looking at a wristband, not the phone; a banner that vanished is the
          same defect as one that never appeared. */}
      <button
        type="button"
        onClick={onRelease}
        className="mt-3 min-h-tap w-full rounded-lg bg-black/20 font-semibold"
      >
        Next guest
      </button>
    </div>
  );
}
