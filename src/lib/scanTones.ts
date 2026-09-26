import type { ScanTone } from "./scanVerdict";

/**
 * The verdict, for a volunteer who is not looking at the screen.
 *
 * The old beep was one 880Hz blip fired on RAW DECODE — before the server
 * answered — and only in continuous mode. So it sounded identically for a valid
 * ticket, an unknown code, and a competition-fee receipt, and /checkin was
 * silent altogether. It was the audio twin of the library's green viewfinder:
 * "a QR was legible", dressed up as "that worked".
 *
 * These fire AFTER the server answers, in both modes, and there are three of
 * them because there are three tones.
 *
 * Distinguishable on three independent axes, so none of them has to be learned
 * against the others in a noisy hall:
 *
 *   go    two notes, RISING,  200ms
 *   hold  one note,  flat,    220ms
 *   stop  two notes, FALLING, 320ms
 *
 * Note count, pitch direction and duration each separate all three on their
 * own. A volunteer who only registers "that was one long flat note" still knows
 * not to hand over a wristband.
 */
export const TONE_SEQUENCE: Record<ScanTone, ReadonlyArray<{ hz: number; ms: number }>> = {
  go: [
    { hz: 660, ms: 90 },
    { hz: 990, ms: 110 },
  ],
  hold: [{ hz: 440, ms: 220 }],
  stop: [
    { hz: 523, ms: 120 },
    { hz: 330, ms: 200 },
  ],
};

/** Quiet enough to live beside for four hours; loud enough over a hall. */
const GAIN = 0.05;

let shared: AudioContext | null = null;

/**
 * Create the AudioContext on a USER GESTURE and reuse it.
 *
 * iOS Safari starts a context created outside a gesture in `suspended`, and
 * throttles rapid create/close cycles — which the old code did once per beep.
 * The practical result of getting this wrong is that the whole three-tone
 * vocabulary is silent on exactly the phones volunteers hold. Call this from
 * the "Start scanning" tap.
 */
export function primeAudio(): void {
  if (shared) {
    if (shared.state === "suspended") void shared.resume().catch(() => {});
    return;
  }
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    shared = new Ctx();
  } catch {
    /* no audio on this device — the banner is the primary channel anyway */
  }
}

/**
 * Play a tone. Best-effort and never throws: audio is the SECOND channel, and a
 * muted phone must never stop a door working.
 */
export function playTone(tone: ScanTone): void {
  if (!shared) primeAudio();
  const ctx = shared;
  if (!ctx) return;
  try {
    let at = ctx.currentTime;
    for (const note of TONE_SEQUENCE[tone]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = note.hz;
      gain.gain.value = GAIN;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      at += note.ms / 1000;
      osc.stop(at);
    }
  } catch {
    /* best effort */
  }
}

/** Total length of a tone, ms. Exported so the suite can assert they differ. */
export function toneDurationMs(tone: ScanTone): number {
  return TONE_SEQUENCE[tone].reduce((s, n) => s + n.ms, 0);
}
