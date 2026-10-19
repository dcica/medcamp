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

/**
 * A quantity break: from `minQty` units of ONE service on ONE order line,
 * every unit on that line costs `unitCents`. Diwali's kids carnival sells
 * "4 or more of the same ticket, 20% off". Per line, never cart-wide.
 */
export type BulkRule = { minQty: number; unitCents: number };

export type ResolvedPrice = {
  amountCents: number;
  phase: PricePhase;
  /** Set only when an early-bird window is currently open. Drives the phase strip. */
  earlyBirdEndsAt: Date | null;
  /** Set when a later, higher price exists. Drives "then $20 at the door". */
  nextAmountCents: number | null;
  /**
   * The quantity break on this offering, when one exists AND undercuts the
   * phase price; null otherwise. Carried so a display feed can say "$8 each
   * when you buy 4+" from the same resolution the charge uses.
   */
  bulk: BulkRule | null;
  /** True when `amountCents` is the break price rather than the phase price. */
  bulkApplied: boolean;
};

export type PriceableCap = {
  priceCents: number;
  onsitePriceCents: number | null;
  earlyBirdPriceCents: number | null;
  earlyBirdUntil: Date | null;
  /** Optional so every existing caller and verify fixture compiles unchanged. */
  bulkMinQty?: number | null;
  bulkPriceCents?: number | null;
};

/**
 * The break on this cap, or null. Half a rule resolves as no rule (the
 * early-bird posture); a threshold below 2 would be a plain price cut, which
 * the admin refuses but the resolver must not crash on; a break that is not
 * cheaper than the phase price is noise, not a break -- which is also how a
 * cheaper early bird survives it.
 */
export function bulkRuleFor(
  cap: { bulkMinQty?: number | null; bulkPriceCents?: number | null },
  phaseCents: number,
): BulkRule | null {
  const minQty = cap.bulkMinQty ?? null;
  const unitCents = cap.bulkPriceCents ?? null;
  if (minQty === null || unitCents === null) return null;
  if (minQty < 2 || unitCents < 0 || unitCents >= phaseCents) return null;
  return { minQty, unitCents };
}

/**
 * THE line rule. Exported so the register form and the gate's basket total
 * mirror it rather than restate it -- a display total that disagrees with
 * the charge is the defect src/app/register/page.tsx warns about.
 */
export function unitCentsFor(
  phaseCents: number,
  bulk: BulkRule | null,
  quantity: number,
): number {
  return bulk !== null && quantity >= bulk.minQty ? bulk.unitCents : phaseCents;
}

/**
 * Pure admin validation for the two bulk columns, pinned by verify-pricing.
 * Returns the buyer-facing refusal, or null when the pair is acceptable.
 */
export function validateBulkRule(
  minQty: number | null,
  priceCents: number | null,
  regularCents: number,
): string | null {
  if (minQty === null && priceCents === null) return null;
  if (minQty === null || priceCents === null) {
    return "A quantity discount needs both a threshold and a price — set both or clear both.";
  }
  if (!Number.isInteger(minQty) || minQty < 2) {
    return "The quantity discount threshold must be a whole number of at least 2.";
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return "The quantity discount price must be a whole amount, $0.00 or more.";
  }
  if (priceCents >= regularCents) {
    return "The quantity discount price must be lower than the regular price.";
  }
  return null;
}

export function resolvePrice(
  cap: PriceableCap,
  channel: PriceChannel,
  now: Date,
  /**
   * Units on the line being priced. Defaults to one, so every read site that
   * prices a single unit (display feeds, attendee mode) is unchanged; the
   * quantity-mode order builders and the gate pass the line's quantity.
   */
  quantity = 1,
): ResolvedPrice {
  const base = resolvePhase(cap, channel, now);
  const bulk = bulkRuleFor(cap, base.amountCents);
  const amountCents = unitCentsFor(base.amountCents, bulk, quantity);
  return { ...base, amountCents, bulk, bulkApplied: amountCents !== base.amountCents };
}

/** The phase price alone: early bird, online, or door. Quantity never enters here. */
function resolvePhase(
  cap: PriceableCap,
  channel: PriceChannel,
  now: Date,
): Omit<ResolvedPrice, "bulk" | "bulkApplied"> {
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
