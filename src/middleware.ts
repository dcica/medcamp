import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic auth gate. With database sessions the session can't be validated
 * at the edge without a DB round-trip, so middleware only checks that a session
 * cookie is PRESENT and redirects to /login if not. The authoritative check
 * (membership + role) happens server-side via requireRole() in each page.
 */
const PROTECTED = [
  /^\/dashboard(\/|$)/,
  /^\/coordinator(\/|$)/,
  /^\/station(\/|$)/,
  /^\/checkin(\/|$)/,
  /^\/admin(\/|$)/,
];

// NextAuth session cookie names (insecure name in dev/http, __Secure- in https).
const SESSION_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.get(c)?.value);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/coordinator/:path*", "/station/:path*", "/checkin/:path*", "/admin/:path*"],
};
