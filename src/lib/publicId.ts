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

/** Crockford base32: no I, L, O, or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Token length. 8 characters over a 32-symbol alphabet is 40 bits — about 1.1
 * trillion values. At camp scale (hundreds of tickets per event) the collision
 * chance is negligible, and the unique constraint plus retry covers the rest.
 * Short enough to stay readable on a badge and over a phone.
 */
const TOKEN_LENGTH = 8;

/**
 * A fresh public token. Uses `randomInt` (CSPRNG) rather than `Math.random`:
 * the gate authorizes entry on this value alone, so a predictable generator
 * would let someone derive a valid ticket id they never paid for.
 *
 * `randomInt(32)` is rejection-sampled by Node, so the distribution is uniform
 * — a plain `% 32` over a byte would bias the first 8 symbols.
 */
export function generateIdToken(): string {
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Normalize a scanned or hand-typed public id to the stored form.
 *
 * Only the LAST hyphen-separated segment gets the confusable mapping, and that
 * restriction is load-bearing: event codes are ordinary words and one of the
 * live ones is `RON-2026`. Mapping O→0 across the whole string would turn that
 * into `R0N-2026` and the lookup would miss. The token is always the final
 * segment, for both `GARBA-2026-K7M2XQ9T` and `VOL-GARBA-2026-K7M2XQ9T`.
 *
 * Legacy sequential ids (`GARBA-2026-0001`, `MC-2026W-0042`) pass through
 * unchanged — their final segment is digits, which the mapping does not touch.
 * They must keep resolving: tickets sold before this change are in people's
 * inboxes and will be presented at a door.
 */
export function normalizePublicId(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  const cut = trimmed.lastIndexOf("-");
  if (cut === -1) return applyConfusables(trimmed);
  return trimmed.slice(0, cut) + "-" + applyConfusables(trimmed.slice(cut + 1));
}

/**
 * Crockford's decoding rule: I and L read as 1, O reads as 0. The generator
 * never emits these, so any that arrive came from a person reading a badge.
 */
function applyConfusables(segment: string): string {
  return segment.replace(/[ILO]/g, (c) => (c === "O" ? "0" : "1"));
}
