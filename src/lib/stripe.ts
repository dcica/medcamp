import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * Server-side Stripe client. Null when no secret key is configured so the app
 * can run (and free/$0 registrations still work) without Stripe wired up.
 * Approach C: single platform account for now; Connect (per-tenant accounts)
 * is deferred until a real second org exists.
 */
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;
