import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/session";
import { getReconciliationRows } from "@/server/dashboard";
import { toCsv } from "@/lib/csv";

/**
 * Reconciliation CSV export for the active camp. Coordinator / committee-admin
 * only (the "reports" capability). Server-side role check, not just middleware.
 *
 * One row per Payment. `amount_usd` is the gross; `platform_fee_usd` is what
 * Stripe moved to the platform at charge time; `net_before_stripe_processing_usd`
 * is the gross less that fee (Stripe's own processing comes off it on the
 * organisation's statement); `donation_usd` and `fee_cover_usd` say how much
 * of the gross was a gift and the buyer's processing-cost cover; and
 * `stripe_account` is the connected account the charge lives on (blank on
 * the platform key and on cash). See src/lib/reconciliation.ts.
 */
const HEADER = [
  "payment_id",
  "created_at",
  "method",
  "status",
  "amount_usd",
  "platform_fee_usd",
  "net_before_stripe_processing_usd",
  "donation_usd",
  "fee_cover_usd",
  "stripe_account",
  "order_id",
  "registrant_email",
  "stripe_payment_intent",
] as const;

const usd = (cents: number) => (cents / 100).toFixed(2);

export async function GET() {
  const member = await getCurrentMember();
  if (!member || !["COORDINATOR", "COMMITTEE_ADMIN"].includes(member.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { campCode, rows } = await getReconciliationRows();
  if (!campCode) {
    return NextResponse.json({ error: "no active camp" }, { status: 404 });
  }

  const csv = toCsv(
    HEADER,
    rows.map((r) => ({
      payment_id: r.paymentId,
      created_at: r.createdAt,
      method: r.method,
      status: r.status,
      amount_usd: usd(r.amountCents),
      platform_fee_usd: (r.platformFeeCents / 100).toFixed(2),
      net_before_stripe_processing_usd: usd(r.netBeforeProcessingCents),
      donation_usd: (r.donationCents / 100).toFixed(2),
      fee_cover_usd: usd(r.feeCoverCents),
      stripe_account: r.stripeAccountId,
      order_id: r.orderId,
      registrant_email: r.registrantEmail,
      stripe_payment_intent: r.stripePaymentIntentId,
    })),
  );

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reconciliation-${campCode}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
