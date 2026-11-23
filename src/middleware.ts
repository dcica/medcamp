import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalHost, normalizeHost, parseOrgPath } from "@/lib/tenantResolve";

/**
 * Two jobs, in this order:
 *
 * 1. Tenant routing. `/o/<slug>/rest` is rewritten to `/rest` with the slug on
 *    a request header the server reads (src/lib/tenant.ts); the header is
 *    deleted from the incoming request first so a client cannot name an
 *    organisation by sending it. On the platform host (and on localhost) the
 *    slug is also remembered in a cookie, and a bare path with that cookie is
 *    redirected to its `/o/<slug>` form so the URL always says which
 *    organisation it is — a QA tester sharing `platform/register` must not land
 *    the recipient on someone else's tenant. Staff paths on a TENANT host are
 *    sent to the platform host: the session cookie is host-only and tenant
 *    domains share no parent, so that is the only place a session can live.
 *    Every one of those rules is inert until PLATFORM_HOST is set.
 *
 * 2. Optimistic auth gate. With database sessions the session can't be
 *    validated at the edge without a DB round-trip, so middleware only checks
 *    that a session cookie is PRESENT on a protected path and redirects to
 *    /login if not. The authoritative check (membership + role) happens
 *    server-side via requireRole() in each page.
 */
const ORG_SLUG_HEADER = "x-medcamp-org-slug";
const ORG_COOKIE = "medcamp_org";

const PROTECTED = [
  /^\/dashboard(\/|$)/,
  /^\/coordinator(\/|$)/,
  /^\/station(\/|$)/,
  /^\/checkin(\/|$)/,
  // The merged scan station. /gate was MISSING from both of these lists until
  // now: its own requireRole still redirected, so it was not a hole, but an
  // unauthenticated hit rendered the whole page server-side first.
  /^\/scan(\/|$)/,
  /^\/gate(\/|$)/,
  /^\/admin(\/|$)/,
  // Volunteer coordinator dashboard (plural). The public signup/confirm/cert
  // pages live under the singular /volunteer and stay open.
  /^\/volunteers(\/|$)/,
  // Day-of volunteer sign in/out station (staff-only, under singular /volunteer).
  /^\/volunteer\/checkin(\/|$)/,
];

/** Staff surfaces that only make sense on the platform host (session cookie lives there). */
const STAFF_ENTRY = /^\/(login|test-login|staff)(\/|$)/;

/** Platform-level paths that never get the cookie redirect to `/o/<slug>`. */
const PLATFORM_PATHS = /^\/(login|staff|api|test-login|403|robots\.txt|sitemap\.xml)(\/|$)/;

// NextAuth session cookie names (insecure name in dev/http, __Secure- in https).
const SESSION_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = normalizeHost(
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host,
  );
  // Read at call time, not module scope: middleware cannot import the zod env,
  // and verify-tenant exercises this function under several values.
  const platform = normalizeHost(process.env.PLATFORM_HOST ?? null);
  const onPlatform = platform !== null && host === platform;
  const local = host !== null && isLocalHost(host);
  const platformLike = onPlatform || local;

  const parsed = parseOrgPath(url.pathname);
  const effectivePath = parsed ? parsed.rest : url.pathname;
  const isProtected = PROTECTED.some((re) => re.test(effectivePath));

  // 1a. Staff on a tenant host → the platform host, which will set the cookie
  //     for this org and send them on. Inert until PLATFORM_HOST exists.
  if (platform && host && !onPlatform && !local && (isProtected || STAFF_ENTRY.test(effectivePath))) {
    const to = new URL(`https://${platform}/staff/from`);
    to.searchParams.set("host", host);
    to.searchParams.set("then", url.pathname + url.search);
    return NextResponse.redirect(to, 307);
  }

  // 2. Optimistic session gate. callbackUrl is the ORIGINAL path (with its
  //    /o/<slug> prefix) so the sign-in returns to the same organisation.
  if (isProtected) {
    const hasSession = SESSION_COOKIES.some((c) => req.cookies.get(c)?.value);
    if (!hasSession) {
      const login = url.clone();
      login.pathname = "/login";
      login.search = "";
      login.searchParams.set("callbackUrl", url.pathname);
      return NextResponse.redirect(login);
    }
  }

  // 1b. Header hygiene: whatever the client sent under our name is dropped.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(ORG_SLUG_HEADER);

  // 1c. /o/<slug>/rest → /rest, slug on the header, cookie on platform-like hosts.
  if (parsed) {
    requestHeaders.set(ORG_SLUG_HEADER, parsed.slug);
    const target = url.clone();
    target.pathname = parsed.rest;
    const res = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
    if (platformLike) {
      res.cookies.set(ORG_COOKIE, parsed.slug, {
        path: "/",
        sameSite: "lax",
        secure: url.protocol === "https:",
        maxAge: 30 * 24 * 3600,
      });
    }
    return res;
  }

  // 1d. Platform host + remembered org + bare path → the canonical /o/<slug> URL.
  const remembered = req.cookies.get(ORG_COOKIE)?.value;
  if (platformLike && remembered && !PLATFORM_PATHS.test(url.pathname)) {
    const to = url.clone();
    to.pathname = `/o/${remembered}${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.redirect(to, 307);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Every path except static assets: tenant routing has to see public pages
  // too, not just the protected list the auth gate used to match on.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
