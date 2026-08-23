import { cookies } from "next/headers";
import { CHECKOUT_TTL_SECONDS } from "@/lib/checkoutReturn";
import { RESUME_COOKIE_NAME } from "@/lib/checkoutResume";

/**
 * Request-scoped read/write for the checkout-resume proof.
 *
 * Split from src/lib/checkoutResume.ts (which holds the pure signing) so that
 * the MAC can be exercised by scripts/verify-checkout.ts without a request
 * scope, and so that server functions take the proof as an argument instead of
 * reaching for ambient state.
 */

/**
 * Store the proof for the order the buyer is about to be redirected to Stripe
 * for. Overwritten on every hop: it means "the last order this browser started
 * paying for", which is exactly the order a cancel return needs to resume.
 *
 * SameSite=Lax is required and is sufficient. Stripe's cancel return is a
 * top-level GET navigation, which Lax sends the cookie on (Strict would not,
 * and the whole feature would silently do nothing in production while working
 * in local same-origin testing). The resume action is a same-site POST from our
 * own page, so Lax covers that too.
 *
 * Max-Age matches the Checkout session TTL: once the session Stripe is holding
 * has expired, there is nothing left to resume and the proof should stop
 * existing rather than linger as a credential for a dead order.
 */
export async function setResumeCookie(proof: string | null): Promise<void> {
  if (!proof) return;
  const jar = await cookies();
  jar.set(RESUME_COOKIE_NAME, proof, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CHECKOUT_TTL_SECONDS,
  });
}

export async function readResumeCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(RESUME_COOKIE_NAME)?.value ?? null;
}

/** Drop the proof once the order it names is settled and can no longer be resumed. */
export async function clearResumeCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(RESUME_COOKIE_NAME);
}
