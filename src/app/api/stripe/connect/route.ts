import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { handleStripeEvent } from "@/server/stripeWebhook";

/**
 * The CONNECT endpoint: events from every connected account ("Listen to
 * events on connected accounts" in the Stripe dashboard), each tagged with
 * `event.account`, verified with STRIPE_CONNECT_WEBHOOK_SECRET. A direct
 * charge on a connected account reports here and only here; the platform
 * endpoint never sees it. The handler's ownership guard is what keeps one
 * tenant's events from another's.
 */
export async function POST(req: NextRequest) {
  if (!stripe || !env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe Connect webhook not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    );
  }

  return handleStripeEvent(event, "connect");
}
