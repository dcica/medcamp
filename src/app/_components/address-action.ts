"use server";

import { validateAddress } from "@/lib/addressValidation";
import { guard } from "@/server/requestGuard";

/**
 * Server action behind <AddressInput>. Keeps the Google key server-side: the
 * client sends the typed address, gets back a standardized suggestion (or null).
 *
 * RATE LIMITED BECAUSE EVERY CALL SPENDS MONEY. This reaches the Google Address
 * Validation API on the tenant's key, and a server action is an ordinary POST
 * endpoint — "once per address on field blur" is a property of the FORM, not of
 * this function. Anyone can extract the action id and loop it. The free tier is
 * 5,000 calls/month against a budgeted ~500 per camp, so a few thousand
 * automated calls either bill the org or trip the quota and silently degrade
 * address standardization for real registrants.
 *
 * 30 per 10 minutes: a registrant validates a handful of addresses in a sitting,
 * so this is far above real use and far below a bill. Note the limiter is
 * per-serverless-instance (see src/lib/rateLimit.ts) — it is a speed bump, so
 * set a daily quota cap on the key in the Google console as the real ceiling.
 */
export async function checkAddress(raw: string, regionCode = "US") {
  // Returns null rather than throwing on refusal: the caller is an optional
  // convenience on a registration form, and `validateAddress` already answers
  // null when it cannot help. A thrown error here would surface as a broken
  // field on a form the buyer can otherwise complete by hand.
  try {
    await guard("address", 30, 600);
  } catch {
    return null;
  }
  return validateAddress(raw, regionCode);
}
