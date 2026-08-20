import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import {
  confirmOrderPaid,
  MissingCapError,
  OverCapacityError,
} from "@/server/payments";
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
      // Why a full cap is a 200 and everything else is a 5xx:
      //
      // 200 tells Stripe "handled, stop retrying". That is right for a
      // genuinely full cap — the buyer paid, the seat does not exist, and no
      // number of retries changes that; staff issues the refund (there is no
      // self-serve refund flow). Retrying would just re-log the same warning
      // forever.
      //
      // For anything else — a missing cap row, a DB blip, a bug — 200 is a lie
      // that costs money: Stripe records the delivery as successful, never
      // retries, and the paid order stays PENDING with no campId, no QR and no
      // email, invisible until a human notices. A 5xx makes Stripe retry with
      // backoff (confirmOrderPaid is idempotent, so a retry is safe) and lights
      // up the endpoint's failure rate in the Stripe dashboard.
      if (err instanceof OverCapacityError) {
        log.warn("stripe webhook: order over capacity", {
          orderId,
          serviceKey: err.serviceKey,
        });
        return NextResponse.json({ received: true, overCapacity: true });
      }
      if (err instanceof MissingCapError) {
        log.error("stripe webhook: service cap row missing (misconfigured event)", {
          orderId,
          serviceKey: err.serviceKey,
        });
        return NextResponse.json(
          { error: "Service capacity is not configured for this event" },
          { status: 500 },
        );
      }
      // Log the structured line AND rethrow. log.error keeps this failure
      // attributable to an orderId in the runtime log, but the logger normalises
      // an Error down to { name, message } and drops `stack` — and this branch is
      // exactly the class of failure nobody has diagnosed yet, so the stack is
      // the part that matters. Rethrowing lets the framework print it. Next
      // still answers an uncaught throw with a 500, so Stripe retries.
      log.error("stripe webhook: confirmation failed", { orderId, err });
      throw err;
    }
  }

  return NextResponse.json({ received: true });
}
