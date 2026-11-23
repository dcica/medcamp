import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ORG_COOKIE } from "@/lib/tenant";
import { orgCookieOptions, safeThenPath, selectOrgForUser } from "@/server/staffOrg";

export const dynamic = "force-dynamic";

/**
 * GET /api/org/select?slug=<org>&then=<path>
 *
 * Remember the organisation this browser works in on the platform host, then
 * continue to `then`. The slug must be one of the signed-in user's memberships
 * — the cookie is a convenience, never an authorisation — and `then` must be
 * a same-origin path. A bare path is sent to its /o/<slug> form so the URL
 * says which organisation it is.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const then = safeThenPath(req.nextUrl.searchParams.get("then"));

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login, 307);
  }

  const org = await selectOrgForUser(session.user.id, slug);
  if (!org) return NextResponse.redirect(new URL("/403", req.nextUrl), 307);

  const target =
    then.startsWith("/o/") || /^\/(login|staff|api)(\/|$)/.test(then) ? then : `/o/${org.slug}${then}`;
  const res = NextResponse.redirect(new URL(target, req.nextUrl), 307);
  res.cookies.set(ORG_COOKIE, org.slug, orgCookieOptions(req.nextUrl.protocol === "https:"));
  return res;
}
