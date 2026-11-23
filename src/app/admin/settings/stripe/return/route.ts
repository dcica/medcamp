import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentMember } from "@/server/session";
import { accountSnapshot } from "@/server/stripeConnect";

export const dynamic = "force-dynamic";

/**
 * Where Stripe sends the coordinator back after onboarding. Poll the account
 * ONCE for immediate feedback and store the shared snapshot; the
 * `account.updated` webhook keeps it true afterwards (Stripe can disable
 * charges later for a missing requirement). Then back to the settings page,
 * whose card shows the state.
 */
export async function GET(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member || member.role !== "COORDINATOR") {
    return NextResponse.json({ error: "coordinator only" }, { status: 403 });
  }
  const org = await getActiveOrg();
  if (!org?.stripeAccountId || !stripe) {
    return NextResponse.redirect(new URL(`/o/${org?.slug ?? ""}/admin/settings?stripe=none`, req.nextUrl), 307);
  }

  const account = await stripe.accounts.retrieve(org.stripeAccountId);
  const snapshot = accountSnapshot(account);
  await db.organization.update({
    where: { id: org.id },
    data: {
      ...snapshot,
      stripeConnectedAt:
        snapshot.stripeDetailsSubmitted && !org.stripeConnectedAt ? new Date() : org.stripeConnectedAt,
    },
  });

  const state = snapshot.stripeChargesEnabled ? "ok" : "incomplete";
  return NextResponse.redirect(new URL(`/o/${org.slug}/admin/settings?stripe=${state}`, req.nextUrl), 307);
}
