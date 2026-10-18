/**
 * The platform service fee, and the buyer's optional "cover the processing
 * cost" gross-up. PURE: no database, no Stripe, no request scope — so the
 * register form computes in the browser exactly the numbers ensureFeeLines
 * (src/server/payments.ts) writes on the server, and scripts/verify-pricing.ts
 * §9 pins them without a fixture.
 *
 * THE MONEY MODEL (decided 2026-10-18; the reasoning is in the plan and in
 * docs/Payment-Gateway.md):
 *
 *   - Direct charges on the organisation's own connected Stripe account. At
 *     charge time Stripe moves `platformFeeCents` to the platform balance
 *     (`application_fee_amount`); the organisation pays Stripe's processing
 *     at its own rate and the rest is its own. Nothing is ever remitted by us.
 *   - Tickets, merchandise and memberships: percent + fixed per UNIT, capped
 *     per unit — a qty-2 line is two fees, and the cap binds per ticket, not
 *     per order. Donations: 0% by default. A $0 (comped) line carries no fee.
 *   - `payer: "buyer"` adds one PLATFORM_FEE line the buyer sees before
 *     paying. `"absorb"` adds no line and the fee comes out of the
 *     organisation's receipts. Either way the fee is owed to the platform.
 *   - The cover is the ORGANISATION's money, never the platform's: it is
 *     grossed up so the organisation nets its subtotal after Stripe's cut on
 *     the whole charge, service fee included, and it is written as a
 *     FEE_COVER line. On a donation it is simply part of the gift.
 *   - No gratuity of any kind, ever. A fee the buyer cannot decline is a
 *     disclosed line, never a pre-ticked box; the one box there is (the cover)
 *     names its exact amount and its recipient, and clears in one tap.
 *   - ZERO for an organisation with no policy stored, an unreadable one, or
 *     no connected account. Nothing is ever charged on a guess — which is
 *     also what keeps the first tenant's checkout byte-identical to before.
 *
 * The policy lives in `Organization.settings.fees` and is written by a
 * platform operator (scripts/set-fee-policy.ts), not by the tenant: a tenant
 * must not be able to set its own fee to zero. The choices a tenant MAY make
 * — absorbing the fee, whether the cover box starts ticked — are flags here.
 */
import { z } from "zod";
import { formatCents } from "@/lib/money";

/** Mirrors the Prisma enum of the same name on LineItem.feeKind. */
export type FeeLineKind = "PLATFORM_FEE" | "FEE_COVER";

const bucketSchema = z.object({
  /** Basis points of the unit price: 150 = 1.5%. */
  percentBps: z.number().int().min(0).max(10_000),
  fixedCents: z.number().int().min(0),
  /** Per-unit ceiling; null = uncapped. */
  capCents: z.number().int().min(1).nullable(),
});
export type FeeBucket = z.infer<typeof bucketSchema>;

export const feePolicySchema = z.object({
  /** Tickets, merchandise, memberships — everything that is not a gift. */
  tickets: bucketSchema,
  donations: bucketSchema,
  payer: z.enum(["buyer", "absorb"]),
  /** Whether the "cover the processing cost" box is offered at all. */
  allowBuyerCover: z.boolean(),
  /** Whether that box starts ticked. Industry default is on; an org may default it off. */
  feeCoverDefaultChecked: z.boolean(),
  /** The card rate the cover is grossed up at. Stripe's standard: 2.9% + 30¢. */
  processing: z.object({
    percentBps: z.number().int().min(0).max(9_999),
    fixedCents: z.number().int().min(0),
  }),
});
export type FeePolicy = z.infer<typeof feePolicySchema>;

/** What an operator switches on. NOT applied implicitly: no stored policy means no fee. */
export const DEFAULT_FEE_POLICY: FeePolicy = {
  tickets: { percentBps: 150, fixedCents: 49, capCents: 500 },
  donations: { percentBps: 0, fixedCents: 0, capCents: null },
  payer: "buyer",
  allowBuyerCover: true,
  feeCoverDefaultChecked: true,
  processing: { percentBps: 290, fixedCents: 30 },
};

export type StoredFeePolicy =
  /** No `fees` key. Zero fee. */
  | { kind: "none" }
  | { kind: "ok"; policy: FeePolicy }
  /** A `fees` key is present but did not parse. Zero fee; the caller logs it. */
  | { kind: "unreadable"; reason: string };

/**
 * Read and classify the stored policy. Total — never throws, for any input —
 * because it runs on the money path and on the public register page, where a
 * malformed JSON column must cost a fee, not a sale.
 */
export function readFeePolicy(settings: unknown): StoredFeePolicy {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).fees
      : undefined;
  if (raw === undefined || raw === null) return { kind: "none" };
  try {
    const parsed = feePolicySchema.safeParse(raw);
    if (parsed.success) return { kind: "ok", policy: parsed.data };
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return {
      kind: "unreadable",
      reason: path ? `${path}: ${issue?.message}` : (issue?.message ?? "invalid fee policy"),
    };
  } catch (err) {
    return { kind: "unreadable", reason: err instanceof Error ? err.message : "invalid fee policy" };
  }
}

/** The one description a PLATFORM_FEE line ever carries. */
export const PLATFORM_FEE_LABEL = "Service fee";

/**
 * The cover line's description, and the checkbox label on the register form:
 * the exact amount and who receives it, in one sentence. Pinned by
 * verify-pricing §9 — both parts must survive any rewording.
 */
export function coverLabel(coverCents: number, orgName: string): string {
  return `${formatCents(coverCents)} to cover the payment-processing cost for ${orgName}`;
}

/** The subset of a LineItem the fee math reads. Existing fee lines are ignored, so recomputation is idempotent. */
export type FeeableLine = {
  amountCents: number;
  quantity: number;
  isDonation?: boolean;
  membershipPlanId?: string | null;
  feeKind?: FeeLineKind | null;
};

export type FeeLine = {
  feeKind: FeeLineKind;
  description: string;
  amountCents: number;
  quantity: 1;
};

export type OrderFees = {
  /** Goods only: every non-fee line, amount × quantity. */
  subtotalCents: number;
  /** What Stripe moves to the platform. Owed whoever pays it. */
  platformFeeCents: number;
  /** The PLATFORM_FEE line the buyer sees: the fee when `payer` is buyer, else 0. */
  buyerFeeCents: number;
  /** The FEE_COVER line: the organisation's gross-up, 0 unless chosen and allowed. */
  coverCents: number;
  /** What Checkout charges: subtotal + buyerFee + cover. */
  totalCents: number;
  /** The fee lines to write, in order. [] when nothing is owed by the buyer. */
  lines: FeeLine[];
};

/** Fee on ONE unit at this price. $0 carries nothing; the cap binds per unit. */
export function unitFeeCents(amountCents: number, bucket: FeeBucket): number {
  if (amountCents <= 0) return 0;
  const raw = Math.round((amountCents * bucket.percentBps) / 10_000) + bucket.fixedCents;
  return bucket.capCents === null ? raw : Math.min(bucket.capCents, raw);
}

/**
 * How much to add to `baseCents` so the organisation still nets `baseCents`
 * after a card fee of percent + fixed is taken from the grossed-up total.
 * ceil, never floor: a cent short is a cent the organisation eats. A $0 base
 * has no charge at all, so nothing to cover. Shared with the donate page.
 */
export function grossUpForCardFee(
  baseCents: number,
  processing: { percentBps: number; fixedCents: number },
): number {
  if (baseCents <= 0) return 0;
  const gross = Math.ceil(
    ((baseCents + processing.fixedCents) * 10_000) / (10_000 - processing.percentBps),
  );
  return gross - baseCents;
}

/**
 * The fee lines an order should carry, from its goods lines and the policy.
 * `policy: null` (no account, no policy, unreadable policy) is zeros.
 */
export function computeOrderFees(
  lines: FeeableLine[],
  policy: FeePolicy | null,
  opts: { coverProcessing: boolean; orgName: string },
): OrderFees {
  const goods = lines.filter((li) => !li.feeKind);
  const subtotalCents = goods.reduce((s, li) => s + li.amountCents * li.quantity, 0);
  if (!policy) {
    return { subtotalCents, platformFeeCents: 0, buyerFeeCents: 0, coverCents: 0, totalCents: subtotalCents, lines: [] };
  }

  const platformFeeCents = goods.reduce(
    (s, li) =>
      s + unitFeeCents(li.amountCents, li.isDonation ? policy.donations : policy.tickets) * li.quantity,
    0,
  );
  const buyerFeeCents = policy.payer === "buyer" ? platformFeeCents : 0;

  const out: FeeLine[] = [];
  if (buyerFeeCents > 0) {
    out.push({ feeKind: "PLATFORM_FEE", description: PLATFORM_FEE_LABEL, amountCents: buyerFeeCents, quantity: 1 });
  }
  // Grossed up over everything the card is charged other than the cover
  // itself — the service fee included, because Stripe's percentage is taken
  // on the whole charge and the organisation would otherwise be short by
  // 2.9% of the fee on every covered order.
  const coverCents =
    opts.coverProcessing && policy.allowBuyerCover
      ? grossUpForCardFee(subtotalCents + buyerFeeCents, policy.processing)
      : 0;
  if (coverCents > 0) {
    out.push({ feeKind: "FEE_COVER", description: coverLabel(coverCents, opts.orgName), amountCents: coverCents, quantity: 1 });
  }

  return {
    subtotalCents,
    platformFeeCents,
    buyerFeeCents,
    coverCents,
    totalCents: subtotalCents + buyerFeeCents + coverCents,
    lines: out,
  };
}

/**
 * The lines that are the ORGANISATION's receipts: everything but the
 * platform's fee. The cover stays — it is the organisation's money. Used
 * wherever a figure is "what the organisation took": analytics items,
 * revenue break-outs, and (later) the deductible-amount computation.
 */
export function receiptLines<T extends FeeableLine>(lines: T[]): T[] {
  return lines.filter((li) => li.feeKind !== "PLATFORM_FEE");
}
