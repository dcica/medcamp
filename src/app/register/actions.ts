"use server";

import { ZodError } from "zod";
import {
  createRegistration,
  type RegistrationInput,
} from "@/server/registration";
import { createCheckoutForOrder, confirmOrderPaid } from "@/server/payments";

export type SubmitResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

/**
 * Turns a failure from createRegistration into something a buyer can act on.
 *
 * ZodError extends Error and its `.message` is the JSON-serialised issue array,
 * so the previous `err.message` passthrough rendered a raw developer artifact
 * ("[ { \"validation\": \"email\", ... } ]") in the red box. The useful strings
 * are the schema's own `message` values — surface those and nothing else.
 *
 * `instanceof ZodError` rather than a structural (`"issues" in err`) check: zod
 * is a direct dependency imported the same way in src/server/registration.ts, so
 * there is exactly one copy and instanceof is reliable; a duck-type check would
 * silently match anything that grew an `issues` array.
 *
 * Non-Zod Errors keep their message verbatim — createRegistration throws plain
 * Errors with deliberately buyer-facing text ("Registration for this event is
 * not open.") that must pass through unchanged.
 */
function toBuyerMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const messages = [...new Set(err.issues.map((i) => i.message))];
    if (messages.length === 0) return "Please check your details and try again.";
    if (messages.length === 1) return `${messages[0]}.`;
    return `Please check your details: ${messages.join("; ")}.`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Registration failed.";
}

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
    return { ok: false, error: toBuyerMessage(err) };
  }
}
