import { redirect } from "next/navigation";
import { requireMember } from "@/server/session";
import { landingRouteFor } from "@/app/_components/staffNav";

export const dynamic = "force-dynamic";

/**
 * Post-sign-in landing resolver. Renders nothing — it exists to answer "where
 * does this person work?" at the one moment the answer is knowable.
 *
 * WHY A ROUTE AND NOT A callbackUrl: the login screens cannot compute this.
 * They run before authentication, so there is no role yet; both /login and
 * /test-login therefore defaulted to a hardcoded "/dashboard", which is gated to
 * COORDINATOR and COMMITTEE_ADMIN. The result, measured on test: signing in as
 * `volunteer`, `regdesk` or `volcoord` authenticated successfully and landed on
 * /403 — Forbidden as the first screen a volunteer sees on event day.
 *
 * An explicit callbackUrl still wins: someone bounced from /gate to sign in
 * returns to /gate, and never reaches this route at all.
 */
export default async function StaffLandingPage() {
  const member = await requireMember();
  redirect(landingRouteFor(member.role));
}
