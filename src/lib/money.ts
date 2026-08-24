/** Money is integer cents everywhere. These are the only conversion points. */

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Change due for a cash payment, in cents. Never returns negative. */
export function changeDueCents(tenderedCents: number, owedCents: number): number {
  return Math.max(0, tenderedCents - owedCents);
}

/**
 * Card copy: "$25", not "$25.00".
 *
 * Lives here rather than in the component because this file's header is the
 * rule — integer cents everywhere, and these are the ONLY conversion points.
 * A `cents / 100` in a card is how the second rounding convention gets born.
 *
 * Keeps the cents when they are real ("$5.50"), so a price with a card fee
 * folded into it never silently rounds on a public page.
 */
export function formatCentsCompact(cents: number, currency = "USD"): string {
  const s = formatCents(cents, currency);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}
