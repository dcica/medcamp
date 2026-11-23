/**
 * One reconciliation row per Payment: what a treasurer checks against Stripe.
 *
 *   amountCents              the gross the card (or the till) took
 *   platformFeeCents         what Stripe moved to the platform at charge time
 *   netBeforeProcessingCents gross − platform fee; Stripe's own processing
 *                            comes off this on the organisation's statement
 *   donationCents            of the gross, what was a gift
 *   feeCoverCents            of the gross, the buyer's processing-cost cover
 *                            (the organisation's money)
 *   stripeAccountId          the connected account the charge lives on
 *                            ("" on the platform key and on cash)
 *
 * Order-level amounts (donation, cover) and the fee ride on the SUCCEEDED
 * payment only. A PENDING row is a Checkout session somebody opened, not
 * money — the same rule the registrations page and the sales chart apply.
 *
 * Pure, so scripts/verify-csv.ts §6 pins the arithmetic with a literal.
 */
export type ReconLine = {
  amountCents: number;
  quantity: number;
  isDonation: boolean;
  feeKind: string | null;
  status: string;
};

export type ReconPayment = {
  id: string;
  createdAt: Date;
  method: string;
  status: string;
  amountCents: number;
  applicationFeeCents: number | null;
  stripeAccountId: string | null;
  stripePaymentIntentId: string | null;
  orderId: string | null;
  order: { registrantEmail: string; lineItems: ReconLine[] } | null;
};

export type ReconRow = {
  paymentId: string;
  createdAt: string;
  method: string;
  status: string;
  amountCents: number;
  platformFeeCents: number;
  netBeforeProcessingCents: number;
  donationCents: number;
  feeCoverCents: number;
  stripeAccountId: string;
  orderId: string;
  registrantEmail: string;
  stripePaymentIntentId: string;
};

export function toReconRow(p: ReconPayment): ReconRow {
  const money = p.status === "SUCCEEDED";
  const paidLines = money ? (p.order?.lineItems ?? []).filter((li) => li.status === "PAID") : [];
  const sum = (pick: (li: ReconLine) => boolean) =>
    paidLines.filter(pick).reduce((s, li) => s + li.amountCents * li.quantity, 0);
  const platformFeeCents = money ? (p.applicationFeeCents ?? 0) : 0;
  return {
    paymentId: p.id,
    createdAt: p.createdAt.toISOString(),
    method: p.method,
    status: p.status,
    amountCents: p.amountCents,
    platformFeeCents,
    netBeforeProcessingCents: p.amountCents - platformFeeCents,
    donationCents: sum((li) => li.isDonation),
    feeCoverCents: sum((li) => li.feeKind === "FEE_COVER"),
    stripeAccountId: p.stripeAccountId ?? "",
    orderId: p.orderId ?? "",
    registrantEmail: p.order?.registrantEmail ?? "",
    stripePaymentIntentId: p.stripePaymentIntentId ?? "",
  };
}
