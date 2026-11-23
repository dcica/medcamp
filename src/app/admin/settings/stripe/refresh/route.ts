import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { platformOrigin } from "@/lib/orgUrl";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentMember } from "@/server/session";
import { connectReturnUrls } from "@/server/stripeConnect";

export const dynamic = "force-dynamic";

/**
 * Where Stripe sends the coordinator when an onboarding link has expired or
 * been used. Links are single-use, so mint a fresh one for the SAME account
 * and continue; the account id was stored before the first link was minted,
 * which is what makes resuming possible at all.
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

  const link = await stripe.accountLinks.create({
    account: org.stripeAccountId,
    type: "account_onboarding",
    ...connectReturnUrls(org, platformOrigin()),
  });
  return NextResponse.redirect(link.url, 307);
}
