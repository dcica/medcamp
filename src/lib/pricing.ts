/**
 * The single price resolver. Every read site (registration, the register page's
 * display feed, and the gate) must call this instead of reading
 * ServiceCap.priceCents / onsitePriceCents directly — four independent read
 * sites duplicating the door-price rule is how they drift (see task A1).
 *
 * Pure by design: `now` is a parameter, never `new Date()` internally, so
 * verify-pricing can pin time and assert both sides of a deadline.
 */

export type PriceChannel = "online" | "door";
export type PricePhase = "early-bird" | "online" | "door";

export type ResolvedPrice = {
  amountCents: number;
  phase: PricePhase;
  /** Set only when an early-bird window is currently open. Drives the phase strip. */
  earlyBirdEndsAt: Date | null;
  /** Set when a later, higher price exists. Drives "then $20 at the door". */
  nextAmountCents: number | null;
};

export function resolvePrice(
  cap: {
    priceCents: number;
    onsitePriceCents: number | null;
    earlyBirdPriceCents: number | null;
    earlyBirdUntil: Date | null;
  },
  channel: PriceChannel,
  now: Date,
): ResolvedPrice {
  // The door ignores early bird entirely — an early-bird deadline is an
  // advance-purchase promotion, not a time-of-day discount. It only ever
  // charges its own price, falling back to the online price when unset.
  if (channel === "door") {
    return {
      amountCents: cap.onsitePriceCents ?? cap.priceCents,
      phase: "door",
      earlyBirdEndsAt: null,
      nextAmountCents: null,
    };
  }

  // A half-configured early bird (price without deadline, or deadline without
  // price) resolves as if there were no early bird — admin validation (Task
  // A2) rejects that combination, but the resolver must not crash on it.
  const earlyBirdOpen =
    cap.earlyBirdPriceCents !== null &&
    cap.earlyBirdUntil !== null &&
    now < cap.earlyBirdUntil;

  if (earlyBirdOpen) {
    return {
      amountCents: cap.earlyBirdPriceCents!,
      phase: "early-bird",
      earlyBirdEndsAt: cap.earlyBirdUntil,
      // What the buyer would pay if they waited out the early-bird window.
      nextAmountCents: cap.priceCents,
    };
  }

  // Online, no (or expired) early bird. "Next" is the door price, but only
  // when it's strictly higher — a "next price" that isn't higher is noise.
  const nextAmountCents =
    cap.onsitePriceCents !== null && cap.onsitePriceCents > cap.priceCents
      ? cap.onsitePriceCents
      : null;

  return {
    amountCents: cap.priceCents,
    phase: "online",
    earlyBirdEndsAt: null,
    nextAmountCents,
  };
}
