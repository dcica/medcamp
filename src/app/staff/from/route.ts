import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ORG_COOKIE } from "@/lib/tenant";
import { orgCookieOptions, orgForHost, safeThenPath, selectOrgForUser } from "@/server/staffOrg";

export const dynamic = "force-dynamic";

/**
 * GET /staff/from?host=<tenant host>&then=<path>
 *
 * Where the middleware sends a staff path requested on a TENANT host. The
 * session cookie cannot live on that host, so: resolve the organisation from
 * the host, make sure the user is signed in here and belongs to it, remember
 * it, and continue to the same path under /o/<slug>. A bookmarked
 * events.dcica.org/scan therefore lands on the scan station in one hop.
 */
export async function GET(req: NextRequest) {
  const org = await orgForHost(req.nextUrl.searchParams.get("host"));
  if (!org) return NextResponse.json({ error: "unknown host" }, { status: 404 });
  const then = safeThenPath(req.nextUrl.searchParams.get("then"));

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login, 307);
  }

  const allowed = await selectOrgForUser(session.user.id, org.slug);
  if (!allowed) return NextResponse.redirect(new URL("/403", req.nextUrl), 307);

  const target = then.startsWith("/o/") ? then : `/o/${org.slug}${then}`;
  const res = NextResponse.redirect(new URL(target, req.nextUrl), 307);
  res.cookies.set(ORG_COOKIE, org.slug, orgCookieOptions(req.nextUrl.protocol === "https:"));
  return res;
}
