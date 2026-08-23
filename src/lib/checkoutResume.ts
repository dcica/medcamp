import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Proof that THIS browser is the one that started paying for THIS order.
 *
 * WHY A COOKIE AND NOT THE FORM DRAFT. The obvious implementation is to treat
 * the sessionStorage draft as the token: if this tab holds a draft naming the
 * order Stripe handed back, offer to resume it. That authorises exactly the
 * buyers who did not need help. It loses every buyer this feature exists for —
 * an in-app browser (Instagram, WhatsApp) that opened Checkout in a separate
 * window, a tab closed in frustration, a return from the same phone an hour
 * later. Those people would get a sentence, no resume, and an orphaned order.
 *
 * WHY NOT JUST TRUST ?cancelled=<orderId>. Order ids are cuids, which are
 * partly a timestamp and a counter — not unguessable the way the 40-bit CSPRNG
 * campId is (src/lib/publicId.ts). Acting on a bare URL param would turn the
 * cancel page into an oracle: feed it ids and read back a stranger's name,
 * email, phone and basket. Everything the return page does beyond printing one
 * fixed sentence is gated on the MAC below.
 *
 * WHY NOT A TOKEN COLUMN ON `Order`. A stateless MAC needs no migration, and
 * this change is deliberately migration-free (see the plan). There is nothing
 * to clean up, and an expired cookie fails closed on its own.
 */

export const RESUME_COOKIE_NAME = "checkout_resume";

/**
 * Resolve the HMAC key from the first configured candidate.
 *
 * Pure, and takes the candidates as an argument, so verify-checkout.ts can walk
 * every rung of the fallback without mutating process.env.
 *
 * NEXTAUTH_SECRET cannot be the only source: it is `.optional()` in the env
 * schema (src/lib/env.ts:46) and a deployment that uses only the test-login
 * path legitimately has none. STRIPE_SECRET_KEY is the last rung because it is
 * necessarily present wherever a Checkout session can be created at all — which
 * is precisely the condition under which a resume proof can exist. It is only
 * ever an HMAC input and is never transmitted, derived from, or recoverable
 * from the cookie.
 */
export function resolveResumeSecret(candidates: {
  checkoutResumeSecret?: string;
  nextAuthSecret?: string;
  stripeSecretKey?: string;
}): string | null {
  const ordered = [
    candidates.checkoutResumeSecret,
    candidates.nextAuthSecret,
    candidates.stripeSecretKey,
  ];
  for (const candidate of ordered) {
    if (candidate && candidate.length > 0) return candidate;
  }
  return null;
}

function secret(): string | null {
  return resolveResumeSecret({
    checkoutResumeSecret: env.CHECKOUT_RESUME_SECRET,
    nextAuthSecret: env.NEXTAUTH_SECRET,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
}

/** `<orderId>.<mac>`, or null when no secret is configured (resume is then simply not offered). */
export function signResumeProof(orderId: string, key: string | null = secret()): string | null {
  if (!key) return null;
  const mac = createHmac("sha256", key).update(orderId).digest("base64url");
  return `${orderId}.${mac}`;
}

/**
 * Does `proof` authorise `orderId`?
 *
 * The binding is the MAC, and it is computed over the CALLER'S `orderId` — not
 * over the id carried inside the proof. That is the property that stops a proof
 * minted for order A authorising order B: the recomputed MAC simply will not
 * match. Never "optimise" this to hash the embedded id instead; the embedded id
 * is untrusted input and hashing it would make every proof verify itself.
 *
 * The prefix comparison below is therefore belt-and-braces rather than the
 * guard, and is kept because it fails a mismatched proof one HMAC earlier and
 * documents the format at the point of use.
 */
export function verifyResumeProof(
  orderId: string,
  proof: string | null | undefined,
  key: string | null = secret(),
): boolean {
  if (!key || !proof) return false;

  const separator = proof.lastIndexOf(".");
  if (separator <= 0) return false;
  if (proof.slice(0, separator) !== orderId) return false;

  const expected = createHmac("sha256", key).update(orderId).digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(proof.slice(separator + 1), "base64url");
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch. Our own MACs are always 32
  // bytes, so a wrong length is a forgery and leaks nothing by short-circuiting.
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
