/**
 * Canonicalizing a public id that a PERSON typed or a camera read.
 *
 * Split out of src/lib/publicId.ts, which it used to live in, for one concrete
 * reason: publicId imports `node:crypto` for the generator, and this rule is
 * needed by `src/lib/ticketCode.ts`, which `GateStation.tsx` imports as a client
 * component. Importing the generator's module from the browser bundle to reach
 * a pure string function would drag `node:crypto` in behind it. Nothing here
 * imports anything.
 *
 * publicId re-exports `normalizePublicId`, so every existing server-side import
 * of it keeps working unchanged.
 */

/**
 * Normalize a scanned or hand-typed public id to the stored form.
 *
 * Only the LAST hyphen-separated segment gets the confusable mapping, and that
 * restriction is load-bearing: event codes are ordinary words and one of the
 * live ones is `RON-2026`. Mapping O->0 across the whole string would turn that
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
 *
 * STILL CORRECT, AND STILL NECESSARY, after the alphabet went letters-only.
 * The current generator emits no I, L or O either, so on a freshly minted token
 * this mapping is a no-op — but legacy Crockford tokens are in circulation and
 * this is what lets someone who reads `O` off an old badge still resolve it.
 *
 * DO NOT "fix" the direction by adding 0->O or 1->I. Under a letters-only
 * alphabet that looks like the obviously symmetric improvement, and it would
 * corrupt every legacy sequential id in existence: `GB-2026W-0042` would
 * normalize to `GB-2026W-OO42` and stop resolving. Those tickets are in
 * people's inboxes.
 */
export function applyConfusables(segment: string): string {
  return segment.replace(/[ILO]/g, (c) => (c === "O" ? "0" : "1"));
}
