/**
 * What is safe to persist from a log line, and how much of it.
 *
 * The logger takes arbitrary structured fields, and callers pass real values:
 * `log.error("email send failed", { to, err })` puts a guest's address in
 * there. Writing those to a table changes their lifetime from "two hours of
 * platform logs" to "until someone purges them", so the shape has to be
 * narrowed on the way in rather than trusted.
 *
 * Pure and dependency-free, so verify can pin it without a database.
 */

/**
 * Keys whose VALUE is never written, whatever it holds.
 *
 * Substring-matched on a lowercased key, so `stripeSecretKey`, `apiKey` and
 * `X-Signature` are all caught without enumerating spellings. Matching the key
 * rather than sniffing the value is deliberate: a value-based rule has to guess
 * what a secret looks like, and guesses miss.
 */
const DENY = [
  "token",
  "secret",
  "key",
  "password",
  "passwd",
  "authorization",
  "auth",
  "signature",
  "cookie",
  "session",
  "credential",
  "otp",
  "pin",
];

/** Stand-in, so the shape of the record still shows the field was present. */
export const REDACTED = "[redacted]";

/** A single string value longer than this is truncated. */
export const MAX_VALUE_CHARS = 2_000;
/** A stack is worth keeping, but not all of it. */
export const MAX_STACK_CHARS = 4_000;
/** Total fields kept from one call. */
export const MAX_FIELDS = 40;

export function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY.some((d) => k.includes(d));
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[+${value.length - max}]`;
}

/**
 * Reduce arbitrary log fields to something safe and bounded.
 *
 * Objects and arrays are JSON-stringified and clipped rather than walked: a
 * recursive scrub would have to decide what to do with cycles, Buffers, Prisma
 * models and Errors nested three deep, and every one of those is a chance to
 * throw on the error path. Stringify-and-clip cannot.
 */
export function scrubFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!fields) return null;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (kept >= MAX_FIELDS) {
      out["…"] = `${Object.keys(fields).length - kept} more field(s) dropped`;
      break;
    }
    kept++;
    if (isDeniedKey(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (v === null || v === undefined) {
      out[k] = v ?? null;
      continue;
    }
    if (typeof v === "string") {
      out[k] = clip(v, MAX_VALUE_CHARS);
      continue;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      continue;
    }
    try {
      out[k] = clip(JSON.stringify(v) ?? String(v), MAX_VALUE_CHARS);
    } catch {
      // Cyclic, a BigInt, a Proxy that throws — any of these is possible on an
      // error path, and none of them is worth failing the write for.
      out[k] = "[unserializable]";
    }
  }
  return out;
}

/** Pull the Error out of the fields, if a caller attached one. */
export function extractError(fields: Record<string, unknown> | undefined): {
  name: string | null;
  message: string | null;
  stack: string | null;
} {
  const candidate = fields
    ? Object.values(fields).find((v) => v instanceof Error)
    : undefined;
  if (!(candidate instanceof Error)) return { name: null, message: null, stack: null };
  return {
    name: candidate.name,
    message: clip(candidate.message, MAX_VALUE_CHARS),
    stack: candidate.stack ? clip(candidate.stack, MAX_STACK_CHARS) : null,
  };
}

/**
 * A stable grouping key: level + message + error name.
 *
 * NOT the stack, and not the fields. Both vary per occurrence — a line number
 * shifts, an orderId differs every time — and a fingerprint that changes every
 * occurrence groups nothing, which is the same as having no grouping at all.
 *
 * djb2, because this is a bucketing key and nothing else. It is never a
 * security boundary, so a 32-bit non-cryptographic hash is the right size; a
 * SHA here would be cargo cult.
 */
export function fingerprintFor(level: string, message: string, errorName: string | null): string {
  const input = `${level}|${message}|${errorName ?? ""}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
