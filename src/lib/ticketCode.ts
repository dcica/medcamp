import { normalizePublicId } from "./idNormalize";

/**
 * What a volunteer typing at a door actually means by the characters they type.
 *
 * One door is staffed for one event, so the gate shows the event prefix as fixed
 * text and the volunteer types only the trailing token — re-typing `GB-2026W-`
 * for every manual lookup is 8 characters of transcription risk per ticket with
 * a queue waiting.
 *
 * A value that ALREADY contains a hyphen is passed through whole. Tokens never
 * contain one (see src/lib/publicId.ts), so its presence is an unambiguous
 * signal that the operator holds a complete id rather than a token — a pasted
 * code, a scan re-typed by hand, or the case that genuinely happens at a door:
 * someone arrives at the Dandiya gate holding a Garba ticket. Blindly prefixing
 * that would report "no match", when what staff need to see is the ticket
 * resolving against the WRONG EVENT so they can say so.
 *
 * Lives here rather than inside `ManualEntry` because it is a rule, not a
 * layout: the gate screen is being redesigned around it, and the rule has to
 * survive every element on that screen moving.
 *
 * Imports only src/lib/idNormalize.ts, never src/lib/publicId.ts — the gate
 * screen is a client component, and publicId pulls in `node:crypto`.
 */
export function expandTicketCode(eventCode: string, typed: string): string | null {
  const value = typed.trim().toUpperCase();
  if (!value) return null;
  return value.includes("-") ? value : `${eventCode}-${value}`;
}

/** Characters a public id can contain, once the hyphens are accounted for. */
const ID_CHARS = /^[A-Z0-9]+$/;

/**
 * Shortest typed fragment worth searching on. Two characters over the token
 * alphabet is 1 in 484, which against one event's few hundred tickets is
 * already a short list; one character is a third of the roster.
 */
export const MIN_TOKEN_PREFIX = 2;

/**
 * Shortest bare token we will resolve by SUFFIX, across events.
 *
 * EIGHT, because that is the shortest token this system has ever minted —
 * legacy Crockford is 8, current letters-only is 9. It is not a guess about
 * uniqueness; it is the actual floor of the thing being matched.
 *
 * It was 6, and 6 was wrong twice over. The comment claimed a suffix match was
 * "unique by construction at ~40 bits", which is true of a whole token and
 * false of an arbitrary 6-character string (~27 bits). Worse operationally:
 * once manual entry and guest search share one input, every surname of six or
 * more characters — KAPOOR, SHARMA, JOHNSON — passed this test and fired a
 * cross-event `endsWith` scan that could never match, on every keystroke.
 *
 * Eight does not eliminate that: an 8- or 9-letter surname still qualifies.
 * What it does is bound the cost to names that long, after the exact lookup has
 * already missed, on a table whose ceiling is a few hundred rows per event
 * (src/server/registrations.ts:81). The caller should still prefer the PREFIX
 * path for anything that looks like a name — see `tokenPrefixFor`.
 */
const MIN_BARE_TOKEN = 8;

/**
 * Is this typed value a bare token safe to match by SUFFIX across events?
 *
 * Requires >= 8 characters AND at least one letter. The letter test is the
 * load-bearing half, and it is not defensive: legacy sequential ids are pure
 * digits zero-padded to four, and prisma/seed-test.ts mints `-0001` under TWO
 * different event codes (lines 359 and 849). A bare `0001` therefore
 * endsWith-matches two different people at two different events, and a suffix
 * lookup would silently pick one and admit the wrong guest.
 *
 * Crockford-8 and letters-only-9 tokens both carry letters and are ~40 bits, so
 * a suffix match on a REAL token is unique by construction. A non-token that
 * happens to clear both tests (a long surname) simply misses; `getGateView`
 * caps the scan at two rows and refuses rather than guessing if both hit.
 */
export function isBareToken(typed: string): boolean {
  const value = typed.trim().toUpperCase();
  if (value.length < MIN_BARE_TOKEN) return false;
  if (!ID_CHARS.test(value)) return false;
  return /[A-Z]/.test(value);
}

/**
 * A typed fragment usable as a TOKEN PREFIX within one event, or null.
 *
 * This is predictive entry: type `BV` at the door and every ticket whose token
 * starts with `BV` comes back, so nobody types nine characters with a queue
 * waiting. The caller anchors it to the event — `campId startsWith
 * "<eventCode>-<prefix>"` — which does two things at once: it stops `BV` from
 * matching characters inside the event code, and it makes the query anchored
 * and therefore index-eligible, unlike the `contains` clauses beside it.
 *
 * DELIBERATELY DOES NOT REQUIRE A LETTER, unlike `isBareToken` above, and the
 * difference is not an oversight. `isBareToken` needs one because a bare `0001`
 * is ambiguous ACROSS events. A prefix is anchored to a single event's code, so
 * that collision cannot arise and `00` is a perfectly good fragment of
 * `GARBA-2026-0042`.
 */
export function tokenPrefixFor(typed: string): string | null {
  const value = typed.trim().toUpperCase();
  if (value.length < MIN_TOKEN_PREFIX) return null;
  if (value.includes("-")) return null; // a whole id, not a fragment
  if (!ID_CHARS.test(value)) return null;
  return normalizePublicId(value);
}

/**
 * What to try, in order, for a value typed at a door staffed for one event.
 *
 * `exact` is the canonical id to look up first — this event's prefix applied
 * when the operator typed a bare token, the whole value when they typed a
 * complete id. `tokenSuffix` is the cross-event fallback, non-null only when
 * the value passes `isBareToken`, and is what makes a bare token resolve at ANY
 * door: a guest who hands over a code from the wrong event gets a WRONG_EVENT
 * verdict naming their real event, rather than silence.
 *
 * Composes the existing rules rather than replacing them, so `expandTicketCode`
 * keeps its ten pinned assertions untouched.
 */
export type TicketLookup = { exact: string; tokenSuffix: string | null };

export function planTicketLookup(
  eventCode: string,
  typed: string,
): TicketLookup | null {
  const expanded = expandTicketCode(eventCode, typed);
  if (expanded === null) return null;
  return {
    exact: normalizePublicId(expanded),
    tokenSuffix: isBareToken(typed) ? normalizePublicId(typed.trim()) : null,
  };
}
