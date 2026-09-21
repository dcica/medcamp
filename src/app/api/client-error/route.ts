import { NextResponse } from "next/server";
import { log } from "@/lib/logger";

/**
 * Where a browser-side failure goes to be remembered.
 *
 * The logger's sink covers everything the server throws. It cannot see the two
 * places errors actually reach a volunteer: a React render that blew up, and a
 * client component that threw during an interaction. Until now this app had NO
 * error boundaries at all, so those produced the default Next.js page and no
 * record anywhere.
 *
 * DELIBERATELY UNAUTHENTICATED, because the failure being reported may well be
 * "the session broke". It is also therefore a thing strangers can POST to, so:
 *
 *   - nothing here is trusted. The message is clipped, the digest is pattern-
 *     checked, and the route is taken from OUR referer rather than the body.
 *   - it is rate limited per IP, because an open write endpoint without one is
 *     a way to fill a table.
 *   - it records to `warn`, not `error`, so a flood of junk from the internet
 *     can never drown out real server errors in the same view.
 */
export const runtime = "nodejs";

const MAX_MESSAGE = 500;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, { n: number; since: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.since > WINDOW_MS) {
    hits.set(ip, { n: 1, since: now });
    return false;
  }
  e.n++;
  return e.n > MAX_PER_WINDOW;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) {
    // 204 rather than 429: this is telemetry, and the page reporting a crash
    // must not then have to handle an error from the crash reporter.
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const message =
    typeof b.message === "string" ? b.message.slice(0, MAX_MESSAGE) : "(no message)";
  // Next.js digests are hex. Anything else did not come from the framework.
  const digest =
    typeof b.digest === "string" && /^[a-f0-9]{1,64}$/i.test(b.digest)
      ? b.digest
      : null;

  // From the referer, not the body: a client can claim any route it likes.
  let route: string | null = null;
  try {
    const ref = req.headers.get("referer");
    if (ref) route = new URL(ref).pathname;
  } catch {
    /* a malformed referer is not worth failing over */
  }

  log.warn("client error", { message, digest, route, ip });
  return new NextResponse(null, { status: 204 });
}
