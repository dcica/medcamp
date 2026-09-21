/**
 * Addresses that can never be delivered to, and must never be tried.
 *
 * This app mints sentinel recipients for sales that have no buyer inbox:
 * `gate@gate.local` for every walk-up cash sale, and `@dcica.invalid` for
 * membership records with no address on file. `.local` (RFC 6762) and
 * `.invalid` (RFC 6761) are reserved and never resolve.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `dispatch` catches and logs provider
 * errors rather than throwing — correct, because a slow SES must never roll
 * back a paid sale — so these sends fail invisibly. But SES counts them as HARD
 * BOUNCES, and suspends an account over a 5% bounce rate. A 200-walk-up night
 * is 200 hard bounces from one door. Nobody would see it until sending stopped
 * working for real guests.
 *
 * Deliberately NOT `.test` or `.example`. Those are reserved too, but this
 * repo's verify suites and manual QA use them, and silently swallowing a send
 * to an address someone typed on purpose is a nastier surprise than a bounce.
 */
const UNDELIVERABLE_TLDS = [".local", ".invalid"];

export function isUndeliverableAddress(to: string): boolean {
  const at = to.lastIndexOf("@");
  if (at === -1) return false;
  const domain = to.slice(at + 1).trim().toLowerCase();
  return UNDELIVERABLE_TLDS.some((tld) => domain.endsWith(tld));
}
