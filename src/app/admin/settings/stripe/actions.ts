"use server";

import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { platformOrigin } from "@/lib/orgUrl";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";
import { connectReturnUrls } from "@/server/stripeConnect";

export type ConnectResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Connect this organisation's own Stripe account (Standard) and hand the
 * coordinator to Stripe's hosted onboarding. The money for its events will
 * settle there directly; the platform's service fee is split off by Stripe at
 * charge time, and the platform never holds the organisation's funds.
 *
 * The account id is stored BEFORE the link is minted. Account Links are
 * single-use and short-lived; a coordinator who abandons one and comes back
 * must continue the SAME account, not create a second.
 */
export async function connectStripe(): Promise<ConnectResult> {
  const member = await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  if (!stripe) return { ok: false, error: "Stripe is not configured on this deployment." };

  try {
    let accountId = org.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        email: member.email || undefined,
        business_type: "non_profit",
        metadata: { orgId: org.id, orgSlug: org.slug },
      });
      await db.organization.update({
        where: { id: org.id },
        data: { stripeAccountId: account.id },
      });
      accountId = account.id;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      ...connectReturnUrls(org, platformOrigin()),
    });
    return { ok: true, url: link.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Stripe refused the request." };
  }
}
