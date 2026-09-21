/**
 * What a scan MEANT, as one value.
 *
 * The bug this exists for, reported after a live event: "scanner was not very
 * clear. it showd green boundary, but the action was not very clear - checked
 * in, or an already checked code."
 *
 * Green meant four different things at once. html5-qrcode paints the viewfinder
 * corners green the instant a QR is merely PARSEABLE — before any lookup,
 * identically for a valid ticket, a Wi-Fi QR taped to the wall, and another
 * event's code. On top of that the gate used one `bg-green-50` strip for "just
 * admitted" and the SAME `bg-green-50` inside the guest card for "already
 * admitted by someone else", and /checkin used one green card for both of its
 * states. Four meanings, one colour, and the two that matter demand opposite
 * physical actions.
 *
 * ZERO IMPORTS, deliberately. scripts/verify-scan.ts loads this directly, and a
 * single import of anything under src/server would drag Prisma into a tsx
 * script. That is also why the refusal strings BELOW live here rather than in
 * src/server/gate.ts: the server throws them, the screen matches them, and a
 * shared constant is the only way those two cannot drift into paraphrase.
 */

// ── The exact words staff read. Moved here unchanged; gate.ts and checkin.ts
// import and throw them, and verify-gate's rejectsWith rows still match. ──

/** A real, paid code that admits nobody: a competition fee or a merch receipt. */
export const NOT_A_TICKET =
  "Not a ticket — this buys no floor access. Sell them admission.";

/** A ticket whose order was never confirmed, at the gate. */
export const NOT_PAID = "Not paid — take payment before admitting.";

/** The same condition at a camp check-in desk, which routes elsewhere. */
export const PAYMENT_UNCONFIRMED =
  "Payment not confirmed — send to registration desk.";

/** Camp check-in only: the waiver gates entry, not payment. */
export const WAIVER_REQUIRED = "Waiver must be signed before check-in.";

/**
 * Three tones, and only three.
 *
 * `go` = the thing you were about to do is done, act on it.
 * `hold` = nothing is broken, but DON'T do the usual thing — look first.
 * `stop` = this person does not pass on this code.
 *
 * Deliberately not named after colours. The colour is a rendering of the tone,
 * and the audio vocabulary is a second rendering of the same three values, so a
 * volunteer who is not looking at the screen still gets the verdict.
 */
export type ScanTone = "go" | "hold" | "stop";

export type ScanOutcome =
  | "ADMITTED"
  | "CHECKED_IN"
  | "ALREADY_ADMITTED"
  | "ALREADY_CHECKED_IN"
  | "UNPAID"
  | "PAYMENT_UNCONFIRMED"
  | "NOT_A_TICKET"
  | "WRONG_EVENT"
  | "WAIVER_UNSIGNED"
  | "NO_MATCH"
  | "CAMERA_ERROR"
  | "SERVER_ERROR";

export type ScanVerdict = {
  outcome: ScanOutcome;
  tone: ScanTone;
  /**
   * A glyph, because colour alone is not a verdict. Roughly 1 in 12 men has a
   * red-green deficiency, gym lighting is not a colour booth, and a phone at
   * minimum brightness in daylight is close to greyscale. Three shapes that
   * survive all of that.
   */
  glyph: "✓" | "!" | "✕";
  /** Read at arm's length, so three words at most. */
  headline: string;
  /** The specific fact: a time, an amount, an event name, the code itself. */
  detail: string | null;
  /** Imperative. What the volunteer's hands do next. */
  instruction: string | null;
};

/**
 * What the caller actually has when it asks.
 *
 * Formatting stays OUT of this module: the caller passes `at` already rendered
 * by formatVenueTime and `owed` already rendered by formatCents, so the venue
 * timezone rule keeps its single home in src/lib/eventTime.ts and this file
 * keeps its zero imports.
 */
export type ScanSignal =
  | { kind: "admitted"; name?: string | null }
  | { kind: "checkedIn"; name?: string | null; at?: string | null }
  | { kind: "already"; flow: "gate" | "camp"; at?: string | null }
  | { kind: "unpaid"; owed: string }
  | { kind: "paymentUnconfirmed" }
  | { kind: "notATicket" }
  | { kind: "wrongEvent"; eventName: string }
  | { kind: "waiverUnsigned" }
  | { kind: "noMatch"; code: string }
  | { kind: "cameraError"; message?: string | null }
  | { kind: "serverError"; message?: string | null };

/**
 * The ONE mapping. Every screen calls this; no screen decides a tone.
 *
 * WHY "already" IS `hold` AND NOT `go` — the single most important line here,
 * and the reported bug in one rule.
 *
 * The verdict answers exactly one question: did MY scan change something, and
 * may this person pass? A fresh admit and a repeat scan demand OPPOSITE
 * physical actions. Fresh: hand over a wristband, print a badge. Repeat: hand
 * over NOTHING, and start a conversation — duplicate ticket, phone passed back
 * over the fence, or the same guest legitimately re-entering. Sharing a colour
 * makes the branch that costs money invisible. A second wristband is a free
 * entry; a second badge is a second route through a clinic.
 *
 * Red would be wrong too. It would train volunteers that re-scans are failures,
 * and re-scans are routine — verify-gate §5 exists precisely because they are.
 * Nothing is broken when idempotency holds.
 *
 * Amber is this repo's existing word for exactly this: green=OPEN,
 * amber=CLOSED, red=problem (CLAUDE.md, enforced by verify-branding §8). The
 * door is closed to this code, and nothing is wrong.
 */
export function verdictFor(signal: ScanSignal): ScanVerdict {
  switch (signal.kind) {
    case "admitted":
      return {
        outcome: "ADMITTED",
        tone: "go",
        glyph: "✓",
        headline: "Admitted",
        detail: signal.name ?? null,
        instruction: "Give wristband",
      };

    case "checkedIn":
      return {
        outcome: "CHECKED_IN",
        tone: "go",
        glyph: "✓",
        headline: "Checked in",
        detail: [signal.name, signal.at].filter(Boolean).join(" · ") || null,
        instruction: "Print badge",
      };

    case "already":
      return signal.flow === "gate"
        ? {
            outcome: "ALREADY_ADMITTED",
            tone: "hold",
            glyph: "!",
            headline: "Already in",
            detail: signal.at ? `Admitted ${signal.at}` : null,
            instruction: "No wristband — ask before letting them through",
          }
        : {
            outcome: "ALREADY_CHECKED_IN",
            tone: "hold",
            glyph: "!",
            headline: "Already checked in",
            detail: signal.at ? `Checked in ${signal.at}` : null,
            instruction: "Badge already issued — reprint only if asked",
          };

    case "unpaid":
      return {
        outcome: "UNPAID",
        tone: "stop",
        glyph: "✕",
        headline: "Unpaid",
        detail: `Owes ${signal.owed}`,
        instruction: "Take cash, then admit",
      };

    case "paymentUnconfirmed":
      return {
        outcome: "PAYMENT_UNCONFIRMED",
        tone: "stop",
        glyph: "✕",
        headline: "Not paid",
        detail: PAYMENT_UNCONFIRMED,
        instruction: "Send to the registration desk",
      };

    case "notATicket":
      return {
        outcome: "NOT_A_TICKET",
        tone: "stop",
        glyph: "✕",
        headline: "Not a ticket",
        detail: NOT_A_TICKET,
        instruction: "Sell them admission",
      };

    case "wrongEvent":
      return {
        outcome: "WRONG_EVENT",
        tone: "stop",
        glyph: "✕",
        headline: "Wrong event",
        // Naming the event is the whole value of resolving a foreign code at
        // all: "no match" sends them to the back of this queue, this sends them
        // to the right door.
        detail: `This ticket is for ${signal.eventName}`,
        instruction: "Send them to that door",
      };

    case "waiverUnsigned":
      return {
        outcome: "WAIVER_UNSIGNED",
        tone: "hold",
        glyph: "!",
        headline: "Waiver needed",
        detail: null,
        instruction: "Capture the signature, then check in",
      };

    case "noMatch":
      return {
        outcome: "NO_MATCH",
        tone: "stop",
        glyph: "✕",
        headline: "No match",
        detail: signal.code || null,
        instruction: "Check the code, or type it",
      };

    case "cameraError":
      return {
        outcome: "CAMERA_ERROR",
        tone: "hold",
        glyph: "!",
        headline: "Camera off",
        detail: signal.message ?? null,
        instruction: "Use manual entry below",
      };

    case "serverError":
      return {
        outcome: "SERVER_ERROR",
        tone: "stop",
        glyph: "✕",
        headline: "Didn't save",
        detail: signal.message ?? null,
        instruction: "Try again — nothing was recorded",
      };
  }
}

/**
 * Turn a thrown Error into a signal, for the paths that can only see a message.
 *
 * Matches the exported constants rather than paraphrasing them, which is the
 * reason they moved into this file. Anything unrecognised becomes SERVER_ERROR
 * with its own text — never silence, and never a guess at a friendlier tone.
 */
export function signalForError(message: string): ScanSignal {
  if (message.includes(NOT_A_TICKET)) return { kind: "notATicket" };
  if (message.includes(NOT_PAID)) return { kind: "paymentUnconfirmed" };
  if (message.includes(PAYMENT_UNCONFIRMED)) return { kind: "paymentUnconfirmed" };
  if (message.includes(WAIVER_REQUIRED)) return { kind: "waiverUnsigned" };
  // gate.ts builds this one per-event, so match the stable stem.
  if (message.startsWith("Wrong event")) {
    return { kind: "wrongEvent", eventName: message.replace(/^.*is for /, "").replace(/\.$/, "") };
  }
  return { kind: "serverError", message };
}
