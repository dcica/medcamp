/**
 * Stripe Connect onboarding helpers that are pure, so verify-checkout §13 can
 * pin them without a Stripe call: the one mapping from a connected account's
 * state to the four columns the session create and the settings card read
 * (shared by the onboarding return route and the `account.updated` webhook —
 * two mappings would be two things to forget to update), and the URLs an
 * Account Link sends the coordinator back to.
 */

/** The subset of a Stripe Account this platform reads. Loose on purpose: a webhook payload may omit fields. */
export type AccountStateLike = {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  capabilities?: { us_bank_account_ach_payments?: string | null } | null;
};

export type AccountSnapshot = {
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeAchEnabled: boolean;
};

/** Missing reads as NOT enabled, never as enabled: a charge is refused rather than attempted on a guess. */
export function accountSnapshot(acct: AccountStateLike): AccountSnapshot {
  return {
    stripeChargesEnabled: acct.charges_enabled === true,
    stripePayoutsEnabled: acct.payouts_enabled === true,
    stripeDetailsSubmitted: acct.details_submitted === true,
    stripeAchEnabled: acct.capabilities?.us_bank_account_ach_payments === "active",
  };
}

/**
 * Where Stripe sends the coordinator after (return) or instead of (refresh,
 * when a single-use link has expired) onboarding. On the PLATFORM host under
 * the organisation's /o/<slug> path: that is where the staff session lives,
 * so the return lands signed in, in the right organisation, in one hop.
 */
export function connectReturnUrls(org: { slug: string }, platformOrigin: string) {
  const base = `${platformOrigin.replace(/\/+$/, "")}/o/${org.slug}/admin/settings/stripe`;
  return { return_url: `${base}/return`, refresh_url: `${base}/refresh` };
}
