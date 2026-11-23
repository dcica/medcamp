import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { handleStripeEvent } from "@/server/stripeWebhook";

/**
 * The PLATFORM endpoint: events for charges on the platform's own key (the
 * first tenant's path), verified with STRIPE_WEBHOOK_SECRET. Events for
 * connected accounts arrive at /api/stripe/connect with their own secret —
 * a secret for the wrong endpoint (or the wrong mode) fails constructEvent,
 * the route 400s, Stripe retries, and the order never confirms with nothing
 * going red anywhere, which is why the two never share one.
 */
export async function POST(req: NextRequest) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
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

  return handleStripeEvent(event, "platform");
}
