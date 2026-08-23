"use server";

import { resumeCheckoutForOrder } from "@/server/payments";
import {
  clearResumeCookie,
  readResumeCookie,
  setResumeCookie,
} from "@/server/resumeCookie";
import { guard, guardKey } from "@/server/requestGuard";
import type { CheckoutRoutes } from "@/lib/checkoutReturn";

/**
 * "Finish paying" — shared by every payment flow.
 *
 * Colocated with the shared components rather than under a route, following
 * address-action.ts: this belongs to no single form. /register and /perform
 * both call it, and a POS or membership checkout will too.
 */

export type ResumeResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

export async function resumeCheckout(
  orderId: string,
  routes?: CheckoutRoutes,
): Promise<ResumeResult> {
  try {
    // Two buckets, deliberately. The per-IP one bounds a single attacker; the
    // per-order one bounds attempts against a single ORDER, which is what a
    // guessed-cuid loop is actually attacking and what a distributed loop would
    // otherwise get for free. The order bucket is the wider window because a
    // legitimate buyer taps this once, maybe twice.
    await guard("resume", 20, 600);
    await guardKey(`resume-order:${orderId}`, 10, 600);

    const proof = await readResumeCookie();
    const outcome = await resumeCheckoutForOrder(orderId, proof, routes);

    if (!outcome.ok) {
      // Both refusals get the same sentence on purpose. Distinguishing "you may
      // not resume this" from "this order can no longer be resumed" would tell
      // an unauthorised caller which order ids are real.
      return {
        ok: false,
        error: "That payment can't be resumed. Please check your details and pay below.",
      };
    }

    if (outcome.alreadyConfirmed) {
      // Paid while they were away. The proof is now a credential for an order
      // nothing can be done to, so drop it rather than leave it sitting in the
      // browser for the rest of the hour.
      await clearResumeCookie();
    } else {
      // Re-issued against the new session, extending the window by another TTL
      // — a buyer who backs out twice must not be worse off than one who backs
      // out once.
      await setResumeCookie(outcome.resumeProof);
    }
    return { ok: true, redirectUrl: outcome.url };
  } catch (err) {
    // guard() throws buyer-facing text ("Too many attempts — wait 42s…").
    if (err instanceof Error && err.message) return { ok: false, error: err.message };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
