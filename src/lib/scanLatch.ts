import type { ScanVerdict } from "./scanVerdict";

/**
 * A verdict LATCHES. Nothing but a deliberate tap changes what is on screen.
 *
 * No auto-dismiss timer — and, the part that matters more, AN INCOMING SCAN
 * CANNOT REPLACE A STANDING VERDICT. Without that rule the continuous camera
 * reintroduces the reported bug by another route: scan A reads ALREADY IN
 * (amber), guest B's badge drifts into frame while the volunteer is looking at
 * a wristband, the banner flips to ADMITTED (green), and A is read as admitted.
 * The two seconds after a scan — eyes down, hands busy — are exactly the window
 * in which the screen would change behind them.
 *
 * Pure, and in src/lib rather than inside the station component, for the reason
 * verify-gate's header states: a rule trapped in a component cannot be pinned.
 * `isDuplicateDecode` was lifted out of QrScanner for the same reason, and this
 * sits beside it.
 *
 * NOT a replacement for that 3s duplicate window. They are orthogonal: the
 * debounce stops one badge sitting in frame from firing ten lookups a second;
 * the latch stops a DIFFERENT badge from overwriting a verdict nobody has acted
 * on yet. verify-gate §2 is untouched.
 */

export type StationPhase =
  /** Camera live, decodes accepted. The only phase that accepts one. */
  | { phase: "scanning" }
  /** A server round-trip is in flight. Deliberately silent — see below. */
  | { phase: "reading" }
  /** A verdict stands and is waiting to be acknowledged. */
  | { phase: "held"; verdict: ScanVerdict };

export type StationEvent =
  /** The camera or the manual box produced a code. */
  | { type: "decoded" }
  /** The server answered. */
  | { type: "resolved"; verdict: ScanVerdict }
  /** The volunteer acted on the standing verdict (Admit, Take cash, …). */
  | { type: "acted"; verdict: ScanVerdict }
  /** The volunteer tapped "Next guest". The ONLY way out of `held`. */
  | { type: "release" };

/**
 * THE WHOLE RULE: only `scanning` accepts a decode.
 *
 * `reading` refuses too, so a second badge cannot start a race with the
 * round-trip already in flight and land its verdict second.
 */
export function acceptsDecode(state: StationPhase): boolean {
  return state.phase === "scanning";
}

/**
 * A decode that arrives while held is DROPPED, and the volunteer must be told.
 *
 * A scan that silently does nothing is a new confusion, not an improvement. The
 * station shows a quiet inline nudge and plays NO tone — silence is reserved
 * for "I ignored that on purpose", so it never gets mistaken for a verdict.
 */
export function shouldNudge(state: StationPhase, event: StationEvent): boolean {
  return event.type === "decoded" && state.phase === "held";
}

export function nextPhase(state: StationPhase, event: StationEvent): StationPhase {
  switch (event.type) {
    case "decoded":
      // Dropped unless we were actually scanning. This is the latch.
      return acceptsDecode(state) ? { phase: "reading" } : state;

    case "resolved":
      // A verdict only lands on a round-trip we started. An answer arriving
      // while another verdict stands is stale by definition.
      return state.phase === "reading" ? { phase: "held", verdict: event.verdict } : state;

    case "acted":
      // The volunteer's OWN action DOES update the banner — tapping Admit moves
      // the verdict to ADMITTED. The invariant is narrower than "nothing ever
      // changes": only a deliberate tap changes what is on screen.
      return { phase: "held", verdict: event.verdict };

    case "release":
      return { phase: "scanning" };
  }
}

/** Where a station starts, and where "Next guest" returns it to. */
export const INITIAL_PHASE: StationPhase = { phase: "scanning" };
