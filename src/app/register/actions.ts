"use server";

import {
  createRegistration,
  type RegistrationInput,
} from "@/server/registration";
import { createCheckoutForOrder, confirmOrderPaid } from "@/server/payments";

export type SubmitResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

/**
 * Entry point for the public registration form. Creates a PENDING order, then:
 *   - $0 order  → confirm immediately (no payment), go to confirmation.
 *   - paid order → create a Stripe hosted Checkout session, redirect there.
 * The webhook (not this action) is what authoritatively confirms a paid order.
 */
export async function submitRegistration(
  input: RegistrationInput,
): Promise<SubmitResult> {
  try {
    const { orderId, totalCents } = await createRegistration(input);

    if (totalCents === 0) {
      await confirmOrderPaid(orderId, {
        method: "CASH",
        idempotencyKey: `free-${orderId}`,
      });
      return { ok: true, redirectUrl: `/confirm/${orderId}` };
    }

    const url = await createCheckoutForOrder(orderId);
    return { ok: true, redirectUrl: url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Registration failed.",
    };
  }
}
