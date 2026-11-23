"use server";

import { getActiveOrg } from "@/lib/tenant";
import { resolveOrgDonations } from "@/lib/orgSettings";
import { createDonationOrder, type DonationInput } from "@/server/donations";
import { createCheckoutForOrder } from "@/server/payments";
import { setResumeCookie } from "@/server/resumeCookie";
import { guard } from "@/server/requestGuard";

export type DonateResult =
  | { ok: true; redirectUrl: string; orderId: string }
  | { ok: false; error: string };

/**
 * Entry point for the public donate form. Creates the PENDING donation order
 * and hands it to the ONE hosted-Checkout path every payment takes; the
 * webhook, not this action, confirms it and sends the receipt.
 *
 * Rate-limited like /register: a form that creates database rows on every
 * POST is a form somebody will script. The wording of every refusal is
 * createDonationOrder's own — buyer copy, passed through verbatim.
 */
export async function submitDonation(input: DonationInput): Promise<DonateResult> {
  try {
    await guard("donate", 10, 600);
    const org = await getActiveOrg();
    if (!org) throw new Error("Donations are not open right now.");
    const policy = resolveOrgDonations(org.settings);
    const { orderId } = await createDonationOrder(org.id, input, policy);

    const { url, resumeProof } = await createCheckoutForOrder(orderId, {
      successPath: `/donate/thanks/${orderId}`,
      cancelPath: "/donate",
    });
    // Set on THIS response — it is what lets the donor finish paying if they
    // back out of Stripe, including from a tab they later close.
    await setResumeCookie(resumeProof);
    return { ok: true, redirectUrl: url, orderId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message ? err.message : "Something went wrong — please try again.",
    };
  }
}
