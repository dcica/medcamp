import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * Server-side Stripe client. Null when no secret key is configured so the app
 * can run (and free/$0 registrations still work) without Stripe wired up.
 *
 * ONE client, ONE key — the platform's — for every organisation. Which account
 * a call acts on is a per-request option, not a per-client credential: see
 * `stripeRequestOptions`. That is Stripe Connect's own shape (the platform
 * key plus a `Stripe-Account` header), and it means a second tenant never
 * hands us a secret key of its own.
 */
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

/**
 * The request options for an organisation: nothing at all on the platform
 * path (`stripeAccountId` null — the first tenant's path, byte-identical to
 * before Connect), or `stripeAccount` for a direct charge on the connected
 * account, where the money lands. Every Stripe call on the money path builds
 * its options here so none can forget; scripts/verify-checkout.ts §11 pins
 * that each of them does.
 */
export function stripeRequestOptions(
  org: { stripeAccountId: string | null },
  extra?: Stripe.RequestOptions,
): Stripe.RequestOptions {
  const base: Stripe.RequestOptions = { ...(extra ?? {}) };
  if (org.stripeAccountId) base.stripeAccount = org.stripeAccountId;
  return base;
}
