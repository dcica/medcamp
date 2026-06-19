import { NextRequest, NextResponse } from "next/server";
import { confirmOrderPaid, OverCapacityError } from "@/server/payments";

/**
 * DEV-ONLY: simulate a successful payment without Stripe/webhook plumbing, so
 * the full registration→confirm flow is testable locally. Disabled in prod.
 * POST /api/dev/confirm  body: { orderId }
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 404 });
  }
  const { orderId } = await req.json().catch(() => ({ orderId: undefined }));
  if (!orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }
  try {
    const result = await confirmOrderPaid(orderId, {
      method: "CASH",
      idempotencyKey: `dev-${orderId}`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OverCapacityError) {
      return NextResponse.json(
        { ok: false, overCapacity: true, serviceKey: err.serviceKey },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
