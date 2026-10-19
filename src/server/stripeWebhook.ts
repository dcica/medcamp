import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import {
  confirmOrderPaid,
  markPaymentProcessing,
  reapExpiredCheckout,
  releaseProcessingPayment,
  resolveOwnedOrder,
  MissingCapError,
  OverCapacityError,
} from "@/server/payments";
import { accountSnapshot } from "@/server/stripeConnect";

/**
 * The Stripe webhook — the authoritative confirmation path (locked decision
 * #2). The client redirect after Checkout is cosmetic; THIS is what confirms
 * the order and triggers the QR email. Signature-verified by the route that
 * calls it, idempotent here.
 *
 * Two routes, one handler. The platform endpoint (`/api/stripe/webhook`,
 * STRIPE_WEBHOOK_SECRET) receives events for charges on the platform's own
 * key — the first tenant's path. The Connect endpoint (`/api/stripe/connect`,
 * STRIPE_CONNECT_WEBHOOK_SECRET) receives events for EVERY connected
 * account's charges, each tagged with `event.account`. Both share this body so
 * the order lookup and the ownership guard happen once, and any handler added
 * later inherits them rather than having to remember to repeat them.
 */
export type WebhookScope = "platform" | "connect";

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });

export async function handleStripeEvent(event: Stripe.Event, scope: WebhookScope): Promise<NextResponse> {
  const account = event.account ?? undefined;

  // ── A connected account's state changed (onboarding finished, capability
  //    gained or lost). Cached on the organisation so a session create can
  //    refuse with a sentence instead of a Stripe 400. Connect scope only.
  if (event.type === "account.updated") {
    if (scope !== "connect" || !account) {
      return json({ received: true, note: "not a connect account event" });
    }
    const acct = event.data.object as Stripe.Account;
    const org = await db.organization.findUnique({
      where: { stripeAccountId: account },
      select: { id: true },
    });
    if (!org) return json({ received: true, note: "account not in this deployment" });
    await db.organization.update({
      where: { id: org.id },
      // One mapping, shared with the onboarding return route.
      data: accountSnapshot(acct),
    });
    return json({ received: true });
  }

  // ── A refund settled on Stripe's side (from our admin action or from the
  //    organisation's own dashboard). Settlement in the database lands with
  //    the refunds step; until then the event is acknowledged, not retried.
  if (event.type === "charge.refunded") {
    log.info("stripe webhook: charge.refunded received", { eventId: event.id, scope, account });
    return json({ received: true, note: "refund settlement pending" });
  }

  // Every checkout event carries its order on metadata (set in
  // openCheckoutSession), so they share one entry point. The two async ones
  // are a bank debit's outcome, days after the session completed unpaid.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;
    if (!orderId) return json({ received: true, note: "no orderId" });

    // ── The event belongs to ANOTHER deployment or ANOTHER organisation ──
    //
    // test.dcica.org and events.dcica.org have an endpoint each on the SAME
    // Stripe account, so Stripe fans every event out to both; and the Connect
    // endpoint receives every connected account's events, not one tenant's.
    // Mine means: the order exists here AND its organisation's account is the
    // account the event came from (none, on the platform path).
    //
    // 200 here is the correct answer, not a convenient one: there is nothing in
    // this deployment to act on and no retry can change that. Answering 5xx is
    // what left four events on a permanent retry schedule and got the endpoint
    // flagged by Stripe for disablement (commit 411c01c).
    if (!(await resolveOwnedOrder(orderId, account, scope, session.id))) {
      log.info("stripe webhook: event for another deployment's or organisation's order", {
        orderId,
        eventId: event.id,
        type: event.type,
        scope,
        account,
      });
      return json({ received: true, note: "order not in this deployment" });
    }

    // ── A bank debit failed, days after the session completed ──
    // Give back exactly what the reservation held, mark the payment FAILED,
    // leave the order payable, tell the buyer. Idempotent, so a retry is safe.
    if (event.type === "checkout.session.async_payment_failed") {
      try {
        await releaseProcessingPayment(orderId, session.id);
        return json({ received: true, released: true });
      } catch (err) {
        log.error("stripe webhook: release after failed debit failed", { orderId, err });
        throw err;
      }
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      // A delayed-notification method (a bank debit) completes the session
      // UNPAID and reports the outcome later as async_payment_succeeded or
      // async_payment_failed. Only a PAID session confirms an order; a card
      // session is always paid here, so this changes nothing for cards. An
      // unpaid completion RESERVES: capacity held, payment PROCESSING, no
      // ticket — the buyer is told their payment is on its way.
      if (session.payment_status !== "paid") {
        try {
          await markPaymentProcessing(orderId, {
            id: session.id,
            payment_intent:
              typeof session.payment_intent === "string" ? session.payment_intent : null,
          });
          return json({ received: true, processing: true });
        } catch (err) {
          if (err instanceof OverCapacityError) {
            // The debit will still clear; staff refunds, as for a card.
            log.warn("stripe webhook: debit reservation over capacity", { orderId, serviceKey: err.serviceKey });
            return json({ received: true, overCapacity: true });
          }
          log.error("stripe webhook: debit reservation failed", { orderId, err });
          throw err;
        }
      }
      try {
        await confirmOrderPaid(orderId, {
          method: "STRIPE",
          stripeCheckoutId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string" ? session.payment_intent : undefined,
          // The Stripe event id makes retries idempotent (decision #2).
          idempotencyKey: event.id,
        });
      } catch (err) {
        // Why a full cap is a 200 and everything else is a 5xx:
        //
        // 200 tells Stripe "handled, stop retrying". That is right for a
        // genuinely full cap — the buyer paid, the seat does not exist, and no
        // number of retries changes that; staff issues the refund. Retrying
        // would just re-log the same warning forever.
        //
        // For anything else — a missing cap row, a DB blip, a bug — 200 is a lie
        // that costs money: Stripe records the delivery as successful, never
        // retries, and the paid order stays PENDING with no campId, no QR and no
        // email, invisible until a human notices. A 5xx makes Stripe retry with
        // backoff (confirmOrderPaid is idempotent, so a retry is safe) and lights
        // up the endpoint's failure rate in the Stripe dashboard.
        if (err instanceof OverCapacityError) {
          log.warn("stripe webhook: order over capacity", { orderId, serviceKey: err.serviceKey });
          return json({ received: true, overCapacity: true });
        }
        if (err instanceof MissingCapError) {
          log.error("stripe webhook: service cap row missing (misconfigured event)", {
            orderId,
            serviceKey: err.serviceKey,
          });
          return json({ error: "Service capacity is not configured for this event" }, 500);
        }
        // Log the structured line AND rethrow: the logger drops `stack`, and
        // this branch is exactly the class of failure nobody has diagnosed yet.
        // Next still answers an uncaught throw with a 500, so Stripe retries.
        log.error("stripe webhook: confirmation failed", { orderId, err });
        throw err;
      }
      return json({ received: true });
    }

    // The other half of the story: a buyer who never came back. Stripe emits
    // this only for a session that can NO LONGER be paid, which is what makes
    // cancelling here safe — confirmOrderPaid claims on `status: "PENDING"`,
    // so cancelling an order that later gets paid would swallow the
    // confirmation while the charge was captured.
    try {
      const cancelled = await reapExpiredCheckout(orderId, session.id);
      return json({ received: true, cancelled });
    } catch (err) {
      // A silent failure here leaves a dead order looking live; Stripe
      // retrying is harmless because reapExpiredCheckout is idempotent.
      log.error("stripe webhook: expiry reap failed", { orderId, err });
      throw err;
    }
  }

  return json({ received: true });
}
