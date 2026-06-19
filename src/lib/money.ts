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
