/**
 * Minimal fixed-window rate limiter for unauthenticated, token-addressed
 * endpoints — today the performance-entry capability URL (/perform/<code>).
 *
 * WHAT THIS IS NOT: a distributed limiter. Counters live in the process, so on
 * serverless each instance keeps its own and the effective ceiling is
 * `limit × instances`. It is a speed bump, not a wall.
 *
 * WHY that is adequate here rather than a cop-out. The thing being protected is
 * a lookup by a 40-bit CSPRNG token (src/lib/publicId.ts): guessing one is ~10^12
 * attempts, so the token — not the limiter — is the access control. The limiter
 * exists to stop a script hammering the endpoint from turning that arithmetic
 * into a practical DoS on the database, and a per-instance counter does that.
 *
 * WHEN TO REPLACE IT: the moment a limit needs to be *correct* rather than
 * best-effort — anything money-moving, or a limiter someone relies on for a
 * security claim. Then it needs a shared store (a Postgres table, or Upstash).
 * Do not grow this file into that; swap it.
 *
 * Not an LRU: the map is swept on write once it passes a size threshold, which
 * for a handful of endpoints and a 40-group event is cheaper than maintaining
 * eviction order.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Sweep expired entries once the map is big enough to be worth walking. */
const SWEEP_THRESHOLD = 5_000;

function sweep(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Attempts left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets — suitable for a Retry-After header. */
  retryAfterSeconds: number;
};

/**
 * Consume one unit against `key`. Call once per attempt; a blocked call still
 * counts, so a caller hammering a blocked key stays blocked.
 *
 * `now` is injected so the boundary is testable without sleeping.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitResult {
  if (windows.size > SWEEP_THRESHOLD) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000),
  );
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return {
    ok: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

/** Test/dev helper — drops all counters. */
export function resetRateLimits(): void {
  windows.clear();
}
