/**
 * How many tickets a basket is worth, and what a basket is allowed to contain.
 *
 * The rule itself already existed inside `createQuantityOrder`, where only the
 * online path could reach it. The gate could not: `sellAtGate` hard-coded a
 * single attendee, so a walk-up could be charged for three admissions, have the
 * capacity decremented by three, and walk away with ONE code — money right,
 * people wrong, and silently so.
 *
 * Lifted here rather than shared by calling `createQuantityOrder`, because the
 * online path and the door disagree on four things that all cost money:
 * `isRegistrationOpen` gates on walkInOpensAt, prices resolve at "online"
 * rather than "door", FEE services throw ("that entry has its own form") where
 * the gate must sell them, and the registrant email is a required, validated
 * field that no door has. Sharing the RULE is right; sharing the caller is not.
 *
 * Pure and Prisma-free, so verify can pin it without a database — the same
 * reason expandTicketCode, isDuplicateDecode and formatVenueTime live in lib.
 */

/** One line of a gate basket. */
export type GateSaleItem = { serviceTypeId: string; quantity: number };

/**
 * Enough for any real family, far below any plausible mis-tap.
 *
 * The stepper is a 48px target on a phone held at a door. A fat finger on a $25
 * admission is $500 of cash owed if nothing clamps it, and the volunteer would
 * not notice until the total. Twenty is above every real party this org has
 * sold to and below the range where a typo stops looking like one.
 */
export const GATE_MAX_QTY_PER_LINE = 20;

/** What a line contributes, independent of Prisma's types. */
export type MintableLine = {
  /** ServiceKind, or null for a donation-style line that admits nobody. */
  kind: string | null;
  quantity: number;
  /** How many people ONE unit admits — a "family of 4" chip is 4. */
  admitsCount: number;
};

/**
 * People admitted by a basket: quantity x admitsCount, over ADMISSION lines.
 *
 * A "family of 4" chip bought twice is eight tickets, which the gate could
 * never express before.
 */
export function admissionUnits(lines: MintableLine[]): number {
  return lines
    .filter((l) => l.kind === "ADMISSION")
    .reduce((s, l) => s + l.quantity * Math.max(1, l.admitsCount), 0);
}

/**
 * How many codes to mint.
 *
 * Merch- or fee-only orders still get ONE, so the buyer has something to
 * present at the desk — a receipt, not an admission. That distinction is load
 * bearing: verify-gate's fee rows assert the receipt resolves at the door AND
 * that admitting it is refused.
 */
export function ticketCountFor(lines: MintableLine[]): number {
  const units = admissionUnits(lines);
  return units > 0 ? units : 1;
}

/**
 * Make a basket safe to charge: integers, clamped, merged, empties dropped.
 *
 * Merging duplicate ids is what makes a client sending [{a,1},{a,1}] behave
 * identically to [{a,2}] — otherwise the same sale produces two rows or one
 * depending on how the screen happened to build the list.
 */
export function normalizeGateBasket(items: GateSaleItem[]): GateSaleItem[] {
  const merged = new Map<string, number>();
  for (const item of items) {
    const q = Math.floor(Number(item.quantity));
    if (!Number.isFinite(q) || q <= 0) continue;
    merged.set(item.serviceTypeId, (merged.get(item.serviceTypeId) ?? 0) + q);
  }
  return [...merged.entries()].map(([serviceTypeId, quantity]) => ({
    serviceTypeId,
    quantity: Math.min(quantity, GATE_MAX_QTY_PER_LINE),
  }));
}
