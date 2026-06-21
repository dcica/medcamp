import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { confirmOrderPaid, OverCapacityError } from "@/server/payments";
import { log } from "@/lib/logger";

/**
 * Stripe webhook — the authoritative confirmation path (locked decision #2).
 * The client redirect after Checkout is cosmetic; THIS is what confirms the
 * order and triggers the QR email. Signature-verified and idempotent.
 */
export async function POST(req: NextRequest) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;
    if (!orderId) {
      return NextResponse.json({ received: true, note: "no orderId" });
    }
    try {
      await confirmOrderPaid(orderId, {
        method: "STRIPE",
        stripeCheckoutId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
        // The Stripe event id makes retries idempotent (decision #2).
        idempotencyKey: event.id,
      });
    } catch (err) {
      if (err instanceof OverCapacityError) {
        // Paid but over cap — staff handles refund (no self-serve refund).
        log.warn("stripe webhook: order over capacity", {
          orderId,
          serviceKey: err.serviceKey,
        });
        return NextResponse.json({ received: true, overCapacity: true });
      }
      throw err;
    }
  }

  return NextResponse.json({ received: true });
}
