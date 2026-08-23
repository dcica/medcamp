import { headers } from "next/headers";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Rate-limit plumbing shared by the public, unauthenticated server actions.
 *
 * Lifted verbatim out of src/app/perform/actions.ts when the checkout-resume
 * action became the second caller. It needs next/headers, so it lives here
 * rather than beside the pure limiter in src/lib/rateLimit.ts — importing
 * next/headers into lib would drag a request scope into the verify scripts.
 */

/**
 * Best-effort client identity. `x-forwarded-for` is attacker-controlled in
 * general, but on Vercel the platform overwrites it, and the fallback shares one
 * bucket rather than failing open per-request — a spoofed header therefore buys
 * a bigger bucket, never an unlimited one.
 */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}

/**
 * Consume one attempt against `action` for this client. Throws a message the
 * caller is expected to surface verbatim.
 *
 * See src/lib/rateLimit.ts on why per-instance counters are adequate: these
 * endpoints are addressed by high-entropy tokens, so this exists to stop
 * arithmetic becoming a database DoS, not as the access control itself.
 */
export async function guard(action: string, limit: number, windowSeconds: number) {
  await guardKey(`${action}:${await clientKey()}`, limit, windowSeconds);
}

/**
 * Consume one attempt against an arbitrary bucket.
 *
 * WHY THIS EXISTS SEPARATELY FROM guard(). A per-IP bucket bounds one attacker;
 * it does nothing to bound attempts against one RECORD. The resume action is
 * probed by guessing order ids, and an id is worth guessing from as many
 * addresses as the attacker has — so it is additionally limited on the order id
 * itself, which is the thing actually being attacked. Callers that care use
 * both.
 */
export async function guardKey(key: string, limit: number, windowSeconds: number) {
  const result = rateLimit(key, limit, windowSeconds);
  if (!result.ok) {
    throw new Error(
      `Too many attempts — wait ${result.retryAfterSeconds}s and try again.`,
    );
  }
}
