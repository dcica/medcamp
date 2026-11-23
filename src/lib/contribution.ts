/**
 * The quid-pro-quo disclosure (IRS Publication 1771). When a payment is made
 * partly in exchange for goods or services — a gala seat, a tournament dinner —
 * the written acknowledgment must state the payment, a good-faith estimate of
 * the value received, and that the deductible amount is limited to the excess.
 *
 * FAIR MARKET VALUE IS WHAT THE GUEST RECEIVES, not what it cost the
 * organisation to provide: a $100 seat at a dinner comparable to a $40 meal is
 * $60 deductible even if the meal cost the organisation $30. The figure comes
 * from `ServiceCap.fairMarketValueCents`, set by the organiser per event, and
 * is SNAPSHOTTED onto each line at creation (`LineItem.fairMarketValueCents`)
 * so a receipt re-issued next year reads the value that applied when they
 * paid.
 *
 * Pure: no database, no request scope. The email builder and the verify
 * suites call the same function.
 */
import { formatCents } from "@/lib/money";

export type Contribution = {
  /** Σ amount × quantity over the lines that carry a value. */
  paidCents: number;
  /** Σ fair market value × quantity over the same lines. */
  fairMarketValueCents: number;
  /** Σ max(0, amount − value) × quantity. Never negative: a ticket worth more than it cost deducts nothing. */
  deductibleCents: number;
};

/**
 * The statement for an order, or null when no line carried a value — in which
 * case nothing is said at all. The platform's fee line is never part of it
 * (it carries no value and is not the organisation's receipt); the test on
 * `fairMarketValueCents` alone excludes it, but the fee kind is checked too so
 * that stays true if a fee line ever grows a value by mistake.
 */
export function contributionOf(
  lines: {
    amountCents: number;
    quantity: number;
    fairMarketValueCents: number | null;
    feeKind?: string | null;
  }[],
): Contribution | null {
  const valued = lines.filter((li) => li.fairMarketValueCents !== null && !li.feeKind);
  if (valued.length === 0) return null;
  let paidCents = 0;
  let fairMarketValueCents = 0;
  let deductibleCents = 0;
  for (const li of valued) {
    const value = li.fairMarketValueCents ?? 0;
    paidCents += li.amountCents * li.quantity;
    fairMarketValueCents += value * li.quantity;
    deductibleCents += Math.max(0, li.amountCents - value) * li.quantity;
  }
  return { paidCents, fairMarketValueCents, deductibleCents };
}

/** The sentence, in Pub 1771's own form. One copy, used by text and HTML alike. */
export function contributionSentence(c: Contribution): string {
  return (
    `In exchange for your payment of ${formatCents(c.paidCents)} you received goods or services ` +
    `with an estimated fair market value of ${formatCents(c.fairMarketValueCents)}. ` +
    `The amount that may be deductible for federal income tax purposes is limited to ${formatCents(c.deductibleCents)}.`
  );
}
