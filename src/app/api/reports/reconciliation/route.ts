import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/session";
import { getReconciliationRows } from "@/server/dashboard";

/**
 * Reconciliation CSV export for the active camp. Coordinator / committee-admin
 * only (the "reports" capability). Server-side role check, not just middleware.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member || !["COORDINATOR", "COMMITTEE_ADMIN"].includes(member.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { campCode, rows } = await getReconciliationRows();
  if (!campCode) {
    return NextResponse.json({ error: "no active camp" }, { status: 404 });
  }

  const header = [
    "payment_id",
    "created_at",
    "method",
    "status",
    "amount_usd",
    "order_id",
    "registrant_email",
    "stripe_payment_intent",
  ];
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.paymentId,
        r.createdAt,
        r.method,
        r.status,
        (r.amountCents / 100).toFixed(2),
        r.orderId,
        r.registrantEmail,
        r.stripePaymentIntentId,
      ]
        .map((v) => escape(String(v)))
        .join(","),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reconciliation-${campCode}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
