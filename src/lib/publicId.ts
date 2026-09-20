import { randomInt } from "node:crypto";

/**
 * Random public identifiers for anything a member of the public can see or
 * carry — ticket campIds, volunteer QR codes.
 *
 * WHY random and not a counter: these ids used to be a per-event sequence
 * (`GARBA-2026-0001`). A sequence is a public sales figure. Anyone holding the
 * second ticket sold knows the org sold two, and anyone holding a ticket near
 * the end of an evening can estimate the night's take. It also makes ids
 * guessable — `-0002` exists if `-0003` does — which matters because the gate
 * looks an attendee up by this id alone.
 *
 * WHY Crockford base32 and not hex or a UUID: the id is printed on a badge and
 * typed by a volunteer when a scan fails, at a door, with a queue waiting. Hex
 * contains 0/O and 1/l lookalikes; a UUID is 36 characters and cannot
 * realistically be read aloud or retyped. Crockford's alphabet omits I, L, O
 * and U outright — the first three because they are misread as 1/1/0, and U so
 * that no random string spells an unfortunate word.
 */

/** Letters only: no I, L, O or U. Never a digit -- the keypad is the cost. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Token length. 9 characters over a 22-symbol alphabet is 22^9, about 1.2
 * trillion values, or 40.1 bits.
 *
 * NINE, not eight, and the ninth character is load-bearing. Dropping the ten
 * digits costs 0.54 bits per character; at the old length of 8 the token would
 * have fallen to 35.7 bits -- a 22x smaller space -- and "40 bits" is asserted
 * in prose in six places across this repo, including src/lib/rateLimit.ts,
 * where it carries the argument that the token IS the access control and a
 * limiter is not needed. Nine keeps every one of those statements true without
 * relitigating them.
 *
 * The extra character is close to free at the keyboard: nine letters on one
 * plane is fewer taps than eight mixed characters that cross planes two or
 * three times. That is the whole point -- "only mint alpha tokens so that we
 * don't have to go to numbers while searching", straight off a live event.
 *
 * NOT RETROACTIVE. Ids already minted keep their digits, so a door resolves
 * three shapes at once: legacy sequential (GARBA-2026-0001), Crockford base32
 * (RON-2026-K7M2XQ9T) and letters-only (RON-2026-KQMXWVPZH).
 */
const TOKEN_LENGTH = 9;

/**
 * A fresh public token. Uses `randomInt` (CSPRNG) rather than `Math.random`:
 * the gate authorizes entry on this value alone, so a predictable generator
 * would let someone derive a valid ticket id they never paid for.
 *
 * `randomInt(22)` is rejection-sampled by Node, so the distribution is uniform
 * — a plain `% 22` over a byte would bias the first 10 symbols.
 */
export function generateIdToken(): string {
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** The generator's alphabet and length, exposed so verify can assert on them. */
export const ID_ALPHABET = ALPHABET;
export const ID_TOKEN_LENGTH = TOKEN_LENGTH;

/**
 * Re-exported, not defined here. It lives in src/lib/idNormalize.ts so client
 * components can reach it without pulling `node:crypto` (imported above for the
 * generator) into the browser bundle. Every server-side caller keeps importing
 * it from this module unchanged.
 */
export { normalizePublicId } from "./idNormalize";
