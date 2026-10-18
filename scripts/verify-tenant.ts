/**
 * Tenant-routing regression check.
 *
 *   npx tsx scripts/verify-tenant.ts
 *
 * One shared deployment serves every organisation, and the organisation is
 * resolved from the request: Host header first, then the `/o/<slug>` path,
 * then the staff cookie on the platform host, then DEFAULT_ORG_SLUG — and
 * NEVER "the oldest organisation in the database". That last fallback is what
 * `getActiveOrg()` did until 2026-10, and on a two-org database it quietly
 * serves one tenant's site under the other tenant's name.
 *
 *   §1  the pure resolver (no database)
 *   §2  orgBaseUrl: every absolute URL comes from the organisation's own host
 *   §3  the Prisma-backed lookups and the script-scope fallback (database)
 *   §4  the middleware as a function: rewrite, header hygiene, cookie, redirects
 *
 * §3 creates two scratch organisations and deletes them on the way out.
 */
import * as dotenv from "dotenv";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const SLUG_A = "verify-tenant-a";
const SLUG_B = "verify-tenant-b";
const HOST_A = "a.verify-tenant.invalid";

let failures = 0;
let passes = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(
    `${ok ? "  PASS" : "  FAIL"}  ${label}` +
      (ok
        ? ""
        : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

async function section1(): Promise<void> {
  const { normalizeHost, parseOrgPath, resolveTenantRequest } = await import(
    "../src/lib/tenantResolve"
  );

  console.log("\n§1 normalizeHost: lowercase, first of a list, no port, no trailing dot");
  check("mixed case + port + trailing dot", normalizeHost("Events.DCICA.org:443."), "events.dcica.org");
  check("localhost keeps no port", normalizeHost("localhost:3100"), "localhost");
  check("x-forwarded-host list takes the first", normalizeHost("a.x, b.x"), "a.x");
  check("null in → null out", normalizeHost(null), null);
  check("empty in → null out", normalizeHost("   "), null);

  console.log("\n§1 parseOrgPath: /o/<slug>/rest");
  check(
    "slug + rest",
    parseOrgPath("/o/infinite-minds/register"),
    { slug: "infinite-minds", rest: "/register" },
  );
  check("slug alone → rest is /", parseOrgPath("/o/im"), { slug: "im", rest: "/" });
  check("slug with trailing slash → rest is /", parseOrgPath("/o/im/"), { slug: "im", rest: "/" });
  check("bare /o/ is not a slug", parseOrgPath("/o/"), null);
  check("unrelated path", parseOrgPath("/other"), null);
  check("uppercase/underscore is not a slug", parseOrgPath("/o/Bad_Slug"), null);
  check("/o prefix without slash", parseOrgPath("/oops"), null);

  console.log("\n§1 resolveTenantRequest: host → path → cookie → default, never oldest");
  const dcica = { id: "org_dcica", slug: "dcica" };
  const im = { id: "org_im", slug: "infinite-minds" };
  const bySlugMap: Record<string, typeof dcica> = { dcica, "infinite-minds": im };
  const byHostMap: Record<string, typeof dcica> = { "events.dcica.org": dcica };
  const lookup = {
    byHost: async (h: string) => byHostMap[h] ?? null,
    bySlug: async (s: string) => bySlugMap[s] ?? null,
  };
  const base = { platformHost: "platform.test", defaultSlug: "dcica" as string | undefined };
  const resolve = (input: {
    host?: string | null;
    pathSlug?: string | null;
    cookieSlug?: string | null;
    platformHost?: string | undefined;
    defaultSlug?: string | undefined;
  }) => resolveTenantRequest({ ...base, host: null, pathSlug: null, cookieSlug: null, ...input }, lookup);

  check(
    "tenant host wins",
    await resolve({ host: "events.dcica.org" }),
    { kind: "org", org: dcica, via: "host" },
  );
  check(
    "tenant host + its own slug in the path is still the host's org",
    await resolve({ host: "events.dcica.org", pathSlug: "dcica" }),
    { kind: "org", org: dcica, via: "host" },
  );
  check(
    "tenant host + a FOREIGN slug in the path is not found (never served)",
    await resolve({ host: "events.dcica.org", pathSlug: "infinite-minds" }),
    { kind: "not-found", slug: "infinite-minds" },
  );
  check(
    "platform host + unknown slug → not-found, not a fallback",
    await resolve({ host: "platform.test", pathSlug: "nope" }),
    { kind: "not-found", slug: "nope" },
  );
  check(
    "platform host + known slug → that org via path",
    await resolve({ host: "platform.test", pathSlug: "infinite-minds" }),
    { kind: "org", org: im, via: "path" },
  );
  check(
    "platform host + cookie → that org via cookie",
    await resolve({ host: "platform.test", cookieSlug: "infinite-minds" }),
    { kind: "org", org: im, via: "cookie" },
  );
  check(
    "platform host + stale cookie → none (a stale cookie is not a 404)",
    await resolve({ host: "platform.test", cookieSlug: "deleted-org" }),
    { kind: "none" },
  );
  check(
    "platform host + nothing → none even though a default slug exists",
    await resolve({ host: "platform.test" }),
    { kind: "none" },
  );
  check(
    "unknown host (preview alias) → the default slug",
    await resolve({ host: "medcamp-git-branch.vercel.app" }),
    { kind: "org", org: dcica, via: "default" },
  );
  check(
    "unknown host and no default → none",
    await resolve({ host: "medcamp-git-branch.vercel.app", defaultSlug: undefined }),
    { kind: "none" },
  );
  check(
    "no host at all (script scope) → the default slug",
    await resolve({ host: null }),
    { kind: "org", org: dcica, via: "default" },
  );
  check(
    "no platform host configured: a bare host is treated as unknown → default",
    await resolve({ host: "localhost", platformHost: undefined }),
    { kind: "org", org: dcica, via: "default" },
  );
  check(
    "a path slug beats the cookie and the default on an unknown host",
    await resolve({ host: "medcamp-git-branch.vercel.app", pathSlug: "infinite-minds", cookieSlug: "dcica" }),
    { kind: "org", org: im, via: "path" },
  );
}

async function section2(): Promise<void> {
  const { orgBaseUrl, platformOrigin, isLocalHost } = await import("../src/lib/orgUrl");
  const cfg = { platformHost: "platform.test", fallbackOrigin: "http://localhost:3000/", defaultSlug: "dcica" };
  const noPlatform = { ...cfg, platformHost: undefined };

  console.log("\n§2 orgBaseUrl: the organisation's own host, then the platform, then the fallback");
  check(
    "the primary domain wins over a non-primary listed first",
    orgBaseUrl(
      { slug: "dcica", domains: [{ hostname: "test.dcica.org", isPrimary: false }, { hostname: "events.dcica.org", isPrimary: true }] },
      cfg,
    ),
    "https://events.dcica.org",
  );
  check(
    "a lone non-primary domain is still used",
    orgBaseUrl({ slug: "dcica", domains: [{ hostname: "events.dcica.org", isPrimary: false }] }, cfg),
    "https://events.dcica.org",
  );
  check(
    "no domain + platform host → /o/<slug> on the platform",
    orgBaseUrl({ slug: "infinite-minds", domains: [] }, cfg),
    "https://platform.test/o/infinite-minds",
  );
  check(
    "no domain, no platform host, the default slug → the bare fallback origin, trailing slash stripped",
    orgBaseUrl({ slug: "dcica", domains: [] }, noPlatform),
    "http://localhost:3000",
  );
  check(
    "no domain, no platform host, another slug → /o/<slug> on the fallback",
    orgBaseUrl({ slug: "infinite-minds", domains: [] }, noPlatform),
    "http://localhost:3000/o/infinite-minds",
  );
  check(
    "a local hostname is served over http",
    orgBaseUrl({ slug: "dcica", domains: [{ hostname: "dcica.localhost", isPrimary: true }] }, cfg),
    "http://dcica.localhost",
  );
  check("platformOrigin with a platform host", platformOrigin(cfg), "https://platform.test");
  check("platformOrigin without one is the fallback origin", platformOrigin(noPlatform), "http://localhost:3000");
  check(
    "isLocalHost",
    [isLocalHost("localhost"), isLocalHost("app.localhost"), isLocalHost("127.0.0.1"), isLocalHost("events.dcica.org")],
    [true, true, true, false],
  );
}

async function section3() {
  const { tenantLookup, resolveTenant, getActiveOrg } = await import("../src/lib/tenant");

  console.log("\n§3 Prisma-backed lookups and the script-scope fallback");
  await cleanup();
  const a = await db.organization.create({
    data: {
      slug: SLUG_A,
      name: "Verify Tenant A",
      domains: { create: { hostname: HOST_A, isPrimary: true } },
    },
  });
  const b = await db.organization.create({ data: { slug: SLUG_B, name: "Verify Tenant B" } });
  // One OPEN event each, relative to now (a literal date is a time bomb).
  const startsAt = new Date(Date.now() + 30 * 24 * 3600_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 3600_000);
  const eventA = await db.event.create({
    data: { orgId: a.id, type: "GENERAL", status: "OPEN", code: "VT-A", name: "Verify Tenant A Night", startsAt, endsAt, collectsAttendeeDetails: false },
  });
  const eventB = await db.event.create({
    data: { orgId: b.id, type: "GENERAL", status: "OPEN", code: "VT-B", name: "Verify Tenant B Night", startsAt, endsAt, collectsAttendeeDetails: false },
  });

  const byHost = await tenantLookup.byHost(HOST_A);
  check("byHost finds the organisation behind a hostname", byHost?.id, a.id);
  check("byHost returns the organisation WITH its domains", byHost?.domains.map((d) => d.hostname), [HOST_A]);
  check("byHost of an unknown hostname is null", await tenantLookup.byHost("nope.verify-tenant.invalid"), null);
  check("bySlug finds the organisation", (await tenantLookup.bySlug(SLUG_B))?.id, b.id);
  check("bySlug of an unknown slug is null", await tenantLookup.bySlug("verify-tenant-nope"), null);

  const scriptScope = await resolveTenant();
  check(
    "outside a request, resolveTenant() takes DEFAULT_ORG_SLUG (never the oldest row)",
    scriptScope.kind === "org" ? { via: scriptScope.via, slug: scriptScope.org.slug } : scriptScope,
    { via: "default", slug: process.env.DEFAULT_ORG_SLUG ?? "dcica" },
  );
  const active = await getActiveOrg();
  check("getActiveOrg() in script scope carries a domains array", Array.isArray(active?.domains), true);

  console.log("\n§5 the sitemap is per organisation and per origin");
  const { buildSitemap } = await import("../src/app/sitemap");
  const { eventSlug } = await import("../src/lib/seo");
  const now = new Date();
  const originA = `https://${HOST_A}`;
  const smA = await buildSitemap({ id: a.id }, originA, now);
  check("A's sitemap lists A's event at A's origin", smA.some((e) => e.url === `${originA}/e/${eventSlug(eventA)}`), true);
  check("A's sitemap does not list B's event", smA.some((e) => e.url.includes(eventSlug(eventB))), false);
  check("every url in A's sitemap starts with A's origin", smA.length > 0 && smA.every((e) => e.url.startsWith(originA)), true);
  const originB = `https://platform.test/o/${SLUG_B}`;
  const smB = await buildSitemap({ id: b.id }, originB, now);
  check("B (no domain) is listed under its /o/<slug> origin", smB.some((e) => e.url === `${originB}/e/${eventSlug(eventB)}`), true);
  check("no organisation → an empty sitemap", await buildSitemap(null, "https://platform.test", now), []);

  return { a, b, eventA, eventB };
}

type Fixtures = Awaited<ReturnType<typeof section3>>;

const ADMIT_KEY = "vt-admit";
const FEE_KEY = "vt-entry";
const VOL_EMAIL = "volunteer@verify-tenant.invalid";

/**
 * §7 — the boundary. Everything a visitor can reach without a session is
 * looked up WITH the organisation the request resolved to, so B's order,
 * ticket, entry and signup are invisible on A's host. Refusals carry the same
 * message as "does not exist": a different message would be an oracle that
 * tells a probe which ids are real.
 */
async function section7(f: Fixtures): Promise<void> {
  const { a, b, eventB } = f;
  const { findPublicEvent, findPublicOrder, findTicket } = await import("../src/server/public");
  const { createRegistration } = await import("../src/server/registration");
  const { createPerformanceEntry, getEntryByCode } = await import("../src/server/performance");
  const { confirmOrderPaid, getResumableCheckout, resumeCheckoutForOrder } = await import("../src/server/payments");
  const { signResumeProof } = await import("../src/lib/checkoutResume");
  const { getVolunteerConfirmation, cancelSignup } = await import("../src/server/volunteers");

  console.log("\n§7 public lookups stop at the organisation boundary");

  // B sells one admission and one competition entry.
  const admit = await db.serviceType.create({
    data: { orgId: b.id, key: ADMIT_KEY, name: "VT Admission", priceCents: 2500, kind: "ADMISSION" },
  });
  await db.serviceCap.create({ data: { eventId: eventB.id, serviceTypeId: admit.id, priceCents: 2500, capacity: 50 } });
  const fee = await db.serviceType.create({
    data: { orgId: b.id, key: FEE_KEY, name: "VT Entry", priceCents: 3000, kind: "FEE" },
  });
  await db.serviceCap.create({
    data: {
      eventId: eventB.id, serviceTypeId: fee.id, priceCents: 3000, capacity: 10,
      minParticipants: 1, maxParticipants: 10, minDurationSeconds: 60, maxDurationSeconds: 600,
    },
  });

  const registrant = { name: "Verify Tenant", email: "buyer@verify-tenant.invalid", phone: "5551234567" };
  const entryInput = {
    registrant, marketingConsent: false, eventId: eventB.id, serviceKey: FEE_KEY,
    groupName: "VT Steps", choreographerName: "V T", ageRange: "17+ years", participantCount: 3,
    durationSeconds: 300, songTitle: "Dholida", songDelivery: "UPLOAD" as const,
  };

  // A paid entry in B: its order, its attendee (ticket code) and its entry code.
  const entry = await createPerformanceEntry(entryInput, { orgId: b.id });
  await confirmOrderPaid(entry.orderId, { method: "CASH", idempotencyKey: `vt-${entry.orderId}`, historical: true });
  const ticket = await db.attendee.findFirstOrThrow({ where: { orderId: entry.orderId }, select: { campId: true } });
  const codeB = ticket.campId!;

  check("findPublicEvent: B's event is invisible to A", await findPublicEvent(a.id, eventB.id), null);
  check("findPublicEvent: B's event is visible to B", (await findPublicEvent(b.id, eventB.id))?.id, eventB.id);
  check("findPublicOrder: B's order is invisible to A", await findPublicOrder(a.id, entry.orderId, { include: { lineItems: true } }), null);
  check("findPublicOrder: B's order is visible to B", (await findPublicOrder(b.id, entry.orderId, { include: { lineItems: true } }))?.id, entry.orderId);
  check("findTicket: B's ticket is invisible to A", await findTicket(a.id, codeB, { include: { event: true } }), null);
  check("findTicket: B's ticket is visible to B", (await findTicket(b.id, codeB, { include: { event: true } }))?.campId, codeB);
  check("getEntryByCode: B's entry is invisible to A", await getEntryByCode(a.id, codeB), null);
  check("getEntryByCode: B's entry is visible to B", (await getEntryByCode(b.id, codeB))?.entryId, entry.entryId);

  // createRegistration / createPerformanceEntry refuse a foreign event with the
  // SAME words as a missing one.
  const regInput = { eventId: eventB.id, registrant, marketingConsent: false, quantities: [{ serviceKey: ADMIT_KEY, quantity: 1 }] };
  const missing = await createRegistration({ ...regInput, eventId: "clxxxxxxxxxxxxxxxxxxxxxxx" }, { orgId: b.id }).then(() => "created", (e: Error) => e.message);
  const foreign = await createRegistration(regInput, { orgId: a.id }).then(() => "created", (e: Error) => e.message);
  check("createRegistration: a foreign event is refused with the missing-event message (no oracle)", foreign, missing);
  check("createRegistration: a foreign event is not created", foreign === "created", false);
  const own = await createRegistration(regInput, { orgId: b.id });
  check("createRegistration: the owning organisation creates the order", typeof own.orderId, "string");
  const foreignEntry = await createPerformanceEntry(entryInput, { orgId: a.id }).then(() => "created", (e: Error) => e.message);
  check("createPerformanceEntry: a foreign event is refused with the missing-event message", foreignEntry, missing);

  // The pending admission order in B is resumable by B and nobody else.
  const proof = signResumeProof(own.orderId);
  check("getResumableCheckout: B's pending order is invisible to A", await getResumableCheckout(a.id, own.orderId, proof), null);
  check("getResumableCheckout: B's pending order is visible to B", (await getResumableCheckout(b.id, own.orderId, proof))?.orderId, own.orderId);
  const resumedForeign = await resumeCheckoutForOrder(entry.orderId, signResumeProof(entry.orderId), undefined, { orgId: a.id });
  check("resumeCheckoutForOrder: a foreign order reads as not-authorised", resumedForeign, { ok: false, reason: "not-authorised" });
  const resumedOwn = await resumeCheckoutForOrder(entry.orderId, signResumeProof(entry.orderId), undefined, { orgId: b.id });
  check("resumeCheckoutForOrder: the owning organisation sees the confirmed order", resumedOwn.ok === true && resumedOwn.alreadyConfirmed === true, true);

  // A volunteer signup in B.
  const volunteer = await db.volunteer.create({ data: { orgId: b.id, name: "VT Volunteer", email: VOL_EMAIL } });
  const role = await db.volunteerRole.create({ data: { orgId: b.id, eventId: eventB.id, key: "vt-door", name: "Door", capacity: 2 } });
  // A confirmation view needs the signup code the normal signup path mints.
  const signup = await db.volunteerSignup.create({ data: { volunteerId: volunteer.id, eventId: eventB.id, roleId: role.id, code: "VTB0001" } });
  check("getVolunteerConfirmation: B's signup is invisible to A", await getVolunteerConfirmation(a.id, signup.id), null);
  check("getVolunteerConfirmation: B's signup is visible to B", (await getVolunteerConfirmation(b.id, signup.id)) !== null, true);
  const cancelled = await cancelSignup(a.id, signup.id).then(() => "cancelled", (e: Error) => e.message);
  check("cancelSignup: A cannot cancel B's signup", cancelled, "Signup not found.");
  check("cancelSignup: B's signup is untouched", (await db.volunteerSignup.findUniqueOrThrow({ where: { id: signup.id } })).status, "SIGNED_UP");

  console.log("\n§8 public pages look nothing up by id alone");
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  for (const p of [
    "src/app/register/page.tsx",
    "src/app/vendors/page.tsx",
    "src/app/t/[campId]/page.tsx",
    "src/app/confirm/[orderId]/page.tsx",
    "src/app/perform/page.tsx",
    "src/app/perform/after-payment/[orderId]/page.tsx",
  ]) {
    check(`${p} has no direct event/order/attendee lookup (goes through @/server/public)`, /db\.(event|order|attendee)\.find/.test(src(p)), false);
  }
  check("register/actions.ts passes the resolved organisation into createRegistration", /createRegistration\(input, \{[^}]*orgId/.test(src("src/app/register/actions.ts")), true);
  check("perform/actions.ts passes the resolved organisation into createPerformanceEntry", /createPerformanceEntry\([^)]*\{[^}]*orgId/.test(src("src/app/perform/actions.ts")), true);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

async function section6(): Promise<void> {
  const { absoluteUrl } = await import("../src/lib/seo");

  console.log("\n§6 every absolute URL comes from an origin the caller resolved");
  check("absoluteUrl joins an origin and a path", absoluteUrl("https://x.org", "/e/a"), "https://x.org/e/a");
  check("absoluteUrl tolerates a trailing slash on the origin", absoluteUrl("https://x.org/", "/e/a"), "https://x.org/e/a");
  check("absoluteUrl tolerates a missing leading slash", absoluteUrl("https://x.org", "e/a"), "https://x.org/e/a");

  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const readers = walk(join(process.cwd(), "src"))
    .filter((p) => /NEXT_PUBLIC_APP_URL/.test(readFileSync(p, "utf8")))
    .map((p) => p.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, ""))
    .sort();
  check(
    "NEXT_PUBLIC_APP_URL is read only by env.ts and orgUrl.ts (it is a fallback, not an origin)",
    readers,
    ["src/lib/env.ts", "src/lib/orgUrl.ts"],
  );
  const payments = src("src/server/payments.ts");
  check("the webhook-side email block builds links from the order's organisation", payments.includes("orgBaseUrl(order.org"), true);
  check("checkout return URLs are built from the order's organisation", /buildCheckoutReturn\(\s*order,\s*orgBaseUrl\(order\.org\)/.test(payments), true);
  check("seo.ts no longer owns a siteUrl()", /export function siteUrl\(/.test(src("src/lib/seo.ts")), false);
  check("the root layout's metadataBase is the resolved origin", /metadataBase: new URL\(await getActiveOrigin\(\)\)/.test(src("src/app/layout.tsx")), true);
  const volunteers = src("src/server/volunteers.ts");
  check(
    "every volunteer email link is built from an organisation (orgBaseUrl), never a global",
    [...volunteers.matchAll(/\b(confirmUrl|certUrl)\((?!base: )([^)]*)/g)].every((m) => m[2].startsWith("orgBaseUrl(")) &&
      /\bconfirmUrl\(orgBaseUrl\(/.test(volunteers) &&
      /\bcertUrl\(orgBaseUrl\(/.test(volunteers),
    true,
  );
}

async function section4(): Promise<void> {
  const { middleware } = await import("../src/middleware");
  const { NextRequest } = await import("next/server");
  const SESSION = "next-auth.session-token=abc";

  const run = (url: string, init?: { cookie?: string; headers?: Record<string, string>; platformHost?: string }) => {
    const prev = process.env.PLATFORM_HOST;
    if (init?.platformHost === undefined) delete process.env.PLATFORM_HOST;
    else process.env.PLATFORM_HOST = init.platformHost;
    try {
      const headers = new Headers(init?.headers ?? {});
      if (init?.cookie) headers.set("cookie", init.cookie);
      const res = middleware(new NextRequest(url, { headers }));
      const loc = res.headers.get("location");
      return {
        status: res.status,
        location: loc ? decodeURIComponent(loc) : null,
        rewrite: res.headers.get("x-middleware-rewrite"),
        orgHeader: res.headers.get("x-middleware-request-x-medcamp-org-slug"),
        setsOrgCookie: /(^|,\s*)medcamp_org=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[2] ?? null,
      };
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_HOST;
      else process.env.PLATFORM_HOST = prev;
    }
  };

  console.log("\n§4 middleware: /o/<slug> rewrite, header hygiene, platform cookie, redirects");
  const rw = run("https://events.dcica.org/o/dcica/register?x=1");
  check("/o/<slug>/rest is rewritten to /rest, query kept", rw.rewrite?.endsWith("/register?x=1"), true);
  check("the rewrite carries the slug as a request header", rw.orgHeader, "dcica");
  check("a tenant host never sets the staff cookie", rw.setsOrgCookie, null);

  const spoof = run("https://events.dcica.org/register", { headers: { "x-medcamp-org-slug": "infinite-minds" } });
  check("an incoming x-medcamp-org-slug header is dropped, not forwarded", spoof.orgHeader, null);

  const bare = run("https://events.dcica.org/register", { platformHost: "platform.test" });
  check("a bare public path on a tenant host passes through", [bare.status, bare.rewrite, bare.location], [200, null, null]);

  const plat = run("https://platform.test/o/infinite-minds/register", { platformHost: "platform.test" });
  check("/o/<slug> on the platform host sets the staff cookie", plat.setsOrgCookie, "infinite-minds");

  const cookied = run("https://platform.test/register", { platformHost: "platform.test", cookie: "medcamp_org=dcica" });
  check(
    "platform host + cookie + bare path → 307 to /o/<slug>/path",
    [cookied.status, cookied.location],
    [307, "https://platform.test/o/dcica/register"],
  );
  const login = run("https://platform.test/login", { platformHost: "platform.test", cookie: "medcamp_org=dcica" });
  check("platform paths are exempt from the cookie redirect", [login.status, login.location], [200, null]);
  const api = run("https://platform.test/api/stripe/webhook", { platformHost: "platform.test", cookie: "medcamp_org=dcica" });
  check("/api is exempt from the cookie redirect", [api.status, api.location], [200, null]);

  const staffOnTenant = run("https://events.dcica.org/admin", { platformHost: "platform.test", cookie: SESSION });
  check(
    "a staff path on a tenant host → 307 to the platform host's /staff/from",
    [staffOnTenant.status, staffOnTenant.location],
    [307, "https://platform.test/staff/from?host=events.dcica.org&then=/admin"],
  );
  const staffNoPlatform = run("https://events.dcica.org/admin", { cookie: SESSION });
  check("without PLATFORM_HOST the staff redirect is inert (session passes through)", [staffNoPlatform.status, staffNoPlatform.location], [200, null]);
  const noSession = run("https://events.dcica.org/admin");
  check(
    "without PLATFORM_HOST and without a session → /login as before",
    [noSession.status, noSession.location],
    [307, "https://events.dcica.org/login?callbackUrl=/admin"],
  );
  const noSessionOrgPath = run("https://platform.test/o/dcica/scan", { platformHost: "platform.test" });
  check(
    "no session on /o/<slug>/scan → /login with the FULL original path as callbackUrl",
    [noSessionOrgPath.status, noSessionOrgPath.location],
    [307, "https://platform.test/login?callbackUrl=/o/dcica/scan"],
  );
  const sessionOrgPath = run("https://platform.test/o/dcica/scan", { platformHost: "platform.test", cookie: SESSION });
  check("a session on /o/<slug>/scan is rewritten, not redirected", [sessionOrgPath.status, sessionOrgPath.rewrite?.endsWith("/scan"), sessionOrgPath.orgHeader], [200, true, "dcica"]);
}

const SLUG_C = "verify-tenant-c";
const HOST_C = "c.verify-tenant.invalid";

/**
 * §9 — the organisation seed modules and the seeder they feed. Every tenant
 * is a module under prisma/orgs; `seedOrg` is what db:seed runs per module,
 * so it is exercised here on a scratch module rather than trusted.
 */
async function section9(): Promise<void> {
  const { ORG_SEEDS } = await import("../prisma/orgs");
  const { seedOrg } = await import("../prisma/orgs/seedOrg");
  const { themeSchema } = await import("../src/lib/branding");
  const { normalizeHost } = await import("../src/lib/tenantResolve");

  console.log("\n§9 organisation seed modules");
  check("both tenants have a seed module", ORG_SEEDS.map((o) => o.slug).sort(), ["dcica", "infinite-minds"]);
  for (const o of ORG_SEEDS) {
    check(`${o.slug}: the theme passes the branding validator at seed time`, themeSchema.safeParse(o.settings.theme).success, true);
    const hosts = Object.values(o.domains).flat();
    check(`${o.slug}: every seeded hostname is already normalised`, hosts.every((h) => normalizeHost(h) === h), true);
  }
  const allHosts = ORG_SEEDS.flatMap((o) => Object.values(o.domains).flat());
  check("no hostname is claimed by two tenants", new Set(allHosts).size, allHosts.length);
  const dcica = ORG_SEEDS.find((o) => o.slug === "dcica");
  const im = ORG_SEEDS.find((o) => o.slug === "infinite-minds");
  check("dcica keeps its production host", dcica?.domains.production, ["events.dcica.org"]);
  check("dcica keeps its test host", dcica?.domains.test, ["test.dcica.org"]);
  check("infinite-minds has no test host (its test surface is /o/<slug> on the platform host)", im?.domains.test, []);
  check("development seeds no domain rows (localhost resolves DEFAULT_ORG_SLUG)", ORG_SEEDS.every((o) => o.domains.development.length === 0), true);

  console.log("\n§9 seedOrg on a scratch module");
  const scratch = {
    slug: SLUG_C,
    name: "Verify Tenant C",
    settings: { theme: dcica!.settings.theme, locale: "en" },
    services: [{ key: "vt-c-admit", name: "VT C Admission", priceCents: 1000, kind: "ADMISSION" as const }],
    membershipPlans: [{ key: "vt-c-1yr", name: "VT C Membership", termYears: 1, priceCents: 5100, partySize: 2 }],
    invites: [{ email: "chair@verify-tenant.invalid", role: "COORDINATOR" as const }],
    domains: { production: ["prod.verify-tenant.invalid"], test: [HOST_C], development: [] as string[] },
  };
  await seedOrg(db, scratch, "test");
  const c = await db.organization.findUnique({
    where: { slug: SLUG_C },
    include: { domains: true, serviceTypes: true, membershipPlans: true, invites: true },
  });
  check("seedOrg creates the organisation", c?.name, "Verify Tenant C");
  check("seedOrg writes the domain rows for the named environment only", c?.domains.map((d) => [d.hostname, d.isPrimary]), [[HOST_C, true]]);
  check("seedOrg seeds the service catalogue", c?.serviceTypes.map((s) => s.key), ["vt-c-admit"]);
  check("seedOrg seeds the membership plans", c?.membershipPlans.map((p) => p.key), ["vt-c-1yr"]);
  check("seedOrg seeds the first-admin invite", c?.invites.map((i) => [i.email, i.role]), [["chair@verify-tenant.invalid", "COORDINATOR"]]);
  await seedOrg(db, { ...scratch, name: "Renamed C" }, "test");
  const again = await db.organization.findUnique({ where: { slug: SLUG_C }, include: { domains: true, serviceTypes: true } });
  check("seedOrg is idempotent (no duplicate rows on a second run)", [again?.domains.length, again?.serviceTypes.length], [1, 1]);
  check("seedOrg never renames an existing organisation (a rename is a deliberate manual write)", again?.name, "Verify Tenant C");
  await seedOrg(db, scratch, "development");
  check("seedOrg for development adds no domain row", (await db.orgDomain.count({ where: { org: { slug: SLUG_C } } })), 1);

  console.log("\n§9 the other seeds and the health check follow");
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  check("seed-events.ts no longer upserts the organisation (it looks dcica up)", /organization\.upsert\(/.test(src("prisma/seed-events.ts")), false);
  check("seed-test.ts no longer upserts the organisation", /organization\.upsert\(/.test(src("prisma/seed-test.ts")), false);
  check("seed.ts seeds every module unless SEED_ORGS narrows it", /SEED_ORGS/.test(src("prisma/seed.ts")) && /ORG_SEEDS/.test(src("prisma/seed.ts")), true);
  check("deploy.yml names SEED_ENV on the test and production seed steps", (src(".github/workflows/deploy.yml").match(/SEED_ENV: (test|production)/g) ?? []).length >= 2, true);
  check("health counts service types, not events (a fresh tenant has none)", /serviceType\.count\(\)/.test(src("src/app/api/health/route.ts")), true);
}

const STAFF_EMAIL = "staff@verify-tenant.invalid";
const OTHER_EMAIL = "other@verify-tenant.invalid";
const INVITEE_EMAIL = "invitee@verify-tenant.invalid";

/**
 * §10 — staff on the platform host. The session cookie is host-only and the
 * tenant domains share no parent, so staff sign in on the platform host and
 * pick the organisation they work in: from the host they came from, from
 * their memberships, or from a pending invite in any organisation.
 */
async function section10(f: Fixtures): Promise<void> {
  const { a, b } = f;
  const { safeThenPath, selectOrgForUser, orgForHost, listMemberships, acceptPendingInvites } = await import(
    "../src/server/staffOrg"
  );

  console.log("\n§10 the organisation a staff member works in");
  check("safeThenPath keeps a same-origin path", safeThenPath("/o/dcica/scan?x=1"), "/o/dcica/scan?x=1");
  check("safeThenPath refuses a protocol-relative url", safeThenPath("//evil.example/x"), "/staff");
  check("safeThenPath refuses an absolute url", safeThenPath("https://evil.example/x"), "/staff");
  check("safeThenPath defaults when absent", safeThenPath(null), "/staff");

  const staff = await db.user.create({ data: { email: STAFF_EMAIL, name: "VT Staff" } });
  await db.membership.create({ data: { orgId: b.id, userId: staff.id, role: "COORDINATOR" } });
  // Somebody ELSE belongs to A, so a lookup that forgets the user has a row to
  // leak — without this, "not a member of A" would pass for the wrong reason.
  const other = await db.user.create({ data: { email: OTHER_EMAIL, name: "VT Other" } });
  await db.membership.create({ data: { orgId: a.id, userId: other.id, role: "COORDINATOR" } });
  check("selectOrgForUser: a member's organisation is selectable", (await selectOrgForUser(staff.id, SLUG_B))?.id, b.id);
  check("selectOrgForUser: an organisation they do not belong to is not", await selectOrgForUser(staff.id, SLUG_A), null);
  check("selectOrgForUser: an unknown slug is not", await selectOrgForUser(staff.id, "verify-tenant-nope"), null);
  check("listMemberships: exactly the organisations they belong to", (await listMemberships(staff.id)).map((m) => m.org.slug), [SLUG_B]);
  check("orgForHost: a tenant host resolves its organisation", (await orgForHost(HOST_A))?.id, a.id);
  check("orgForHost: normalises before looking up", (await orgForHost(`${HOST_A.toUpperCase()}:443`))?.id, a.id);
  check("orgForHost: an unknown host is null", await orgForHost("nope.verify-tenant.invalid"), null);

  // A pending invite in each organisation: accepted together on first sign-in,
  // because a sign-in on the platform host resolves no organisation at all.
  const invitee = await db.user.create({ data: { email: INVITEE_EMAIL, name: "VT Invitee" } });
  await db.invite.create({ data: { orgId: a.id, email: INVITEE_EMAIL, role: "COORDINATOR", canHoldTill: true } });
  await db.invite.create({ data: { orgId: b.id, email: INVITEE_EMAIL, role: "STATION_VOLUNTEER" } });
  check("acceptPendingInvites grants every pending invite across organisations", await acceptPendingInvites(invitee.id, INVITEE_EMAIL), 2);
  const granted = await db.membership.findMany({ where: { userId: invitee.id }, include: { org: true }, orderBy: { org: { slug: "asc" } } });
  check("…with each invite's role and flags", granted.map((m) => [m.org.slug, m.role, m.canHoldTill]), [[SLUG_A, "COORDINATOR", true], [SLUG_B, "STATION_VOLUNTEER", false]]);
  check("…and marks the invites accepted", (await db.invite.count({ where: { email: INVITEE_EMAIL, acceptedAt: null } })), 0);
  check("acceptPendingInvites is idempotent", await acceptPendingInvites(invitee.id, INVITEE_EMAIL), 0);

  console.log("\n§10 the routes and the switcher exist and are wired");
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  check("GET /api/org/select exists and validates `then`", /safeThenPath\(/.test(src("src/app/api/org/select/route.ts")) && /selectOrgForUser\(/.test(src("src/app/api/org/select/route.ts")), true);
  check("GET /staff/from exists and resolves the host", /orgForHost\(/.test(src("src/app/staff/from/route.ts")), true);
  check("/staff/org lists memberships", /listMemberships\(/.test(src("src/app/staff/org/page.tsx")), true);
  check("requireMember sends a signed-in user with no organisation to /staff/org", /redirect\("\/staff\/org"\)/.test(src("src/server/session.ts")), true);
  check("the sign-in event accepts pending invites across organisations", /acceptPendingInvites\(/.test(src("src/lib/auth.ts")), true);
  check("test-login takes an orgSlug and sets the staff cookie", /orgSlug/.test(src("src/app/api/test-login/route.ts")) && /ORG_COOKIE/.test(src("src/app/api/test-login/route.ts")), true);
  check("dev login takes an orgSlug", /orgSlug/.test(src("src/app/api/dev/login/route.ts")), true);
  check("the staff menu offers 'Switch organisation' only when there is more than one", /canSwitch/.test(src("src/app/_components/StaffMenu.tsx")) && /canSwitch/.test(src("src/app/_components/SiteHeader.tsx")), true);
}

function rel(p: string): string {
  return p.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
}

function stripComments(s: string): string {
  return s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * §11 — everything that was one tenant's by name becomes a setting: contact
 * and sender addresses, legal identity for receipts, the analytics id, and
 * the fallbacks the app renders when an organisation has not said.
 */
async function section11(): Promise<void> {
  const { profileSchema, resolveOrgProfile, resolveOrgSite, senderFor } = await import("../src/lib/orgSettings");
  const { resolveBranding, themeWithBrand, wordmarkFor } = await import("../src/lib/branding");
  const { buildRelatedMessage } = await import("../src/lib/mime");
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  console.log("\n§11 per-organisation profile and site settings");
  const nulls = { contactEmail: null, senderEmail: null, legalName: null, ein: null, taxStatus: null, receiptStatement: null };
  check("an empty settings blob resolves to a profile of nulls", resolveOrgProfile({}), nulls);
  check(
    "a hostile blob is dropped field by field, never thrown",
    resolveOrgProfile({ profile: { ein: "123", contactEmail: "events@x.org", legalName: 42, taxStatus: "church" } }),
    { ...nulls, contactEmail: "events@x.org" },
  );
  const full = {
    contactEmail: "events@x.org",
    senderEmail: "X <no-reply@x.org>",
    legalName: "X Inc",
    ein: "12-3456789",
    taxStatus: "501c3",
    receiptStatement: "No goods or services were provided in exchange for this contribution.",
  };
  check("a full profile round-trips", resolveOrgProfile({ profile: full }), full);
  check("senderEmail refuses header injection", profileSchema.shape.senderEmail.safeParse("X <a@b.c>\r\nBcc: evil@x.org").success, false);
  check("senderEmail accepts a display-name form", profileSchema.shape.senderEmail.safeParse("Infinite Minds <no-reply@infinitemindstx.org>").success, true);
  check("senderEmail accepts a bare address", profileSchema.shape.senderEmail.safeParse("no-reply@x.org").success, true);
  check(
    "senderFor prefers the organisation's sender and falls back to the deployment's",
    [senderFor({ senderEmail: "X <a@x.org>" }, "Fallback <f@y.org>"), senderFor({ senderEmail: null }, "Fallback <f@y.org>")],
    ["X <a@x.org>", "Fallback <f@y.org>"],
  );
  check(
    "site: a GA id must match the measurement-id shape",
    [resolveOrgSite({ site: { gaMeasurementId: "G-ABCDEF1234" } }).gaMeasurementId, resolveOrgSite({ site: { gaMeasurementId: "UA-1" } }).gaMeasurementId],
    ["G-ABCDEF1234", null],
  );
  check("site: nothing stored → nulls", resolveOrgSite({}), { gaMeasurementId: null, gaApiSecret: null, googleSiteVerification: null });

  console.log("\n§11 no tenant's name is a fallback for another tenant");
  check(
    "wordmarkFor takes the first word, at most 8 characters, else a neutral word",
    [wordmarkFor("Infinite Minds"), wordmarkFor("Denton County Indian Cultural Association"), wordmarkFor("   "), wordmarkFor(null)],
    ["Infinite", "Denton", "Events", "Events"],
  );
  check("resolveBranding derives the wordmark from the org name when no theme is stored", resolveBranding({}, "Infinite Minds").wordmark, "Infinite");
  check(
    "resolveBranding with no organisation at all is neutral",
    [resolveBranding(undefined, undefined).wordmark, resolveBranding(undefined, undefined).orgName],
    ["Events", "Events"],
  );
  const composed = themeWithBrand({ kind: "none" }, "#1d3557", "Infinite Minds");
  check("a first brand-colour save on a themeless org stores THAT org's wordmark", composed.ok ? composed.theme.wordmark : composed.error, "Infinite");

  console.log("\n§11 mail carries the organisation's sender and reply-to");
  const base = { from: "X <no-reply@x.org>", to: "a@b.c", subject: "s", text: "t", html: "<p>t</p>", inlineImages: [], date: new Date(0) };
  const withReply = buildRelatedMessage({ ...base, replyTo: "events@x.org" }).toString("utf8");
  check("Reply-To is emitted when given", /^Reply-To: events@x\.org\r?$/m.test(withReply), true);
  check("…and absent otherwise", /^Reply-To:/m.test(buildRelatedMessage(base).toString("utf8")), false);

  console.log("\n§11 nothing in src names one tenant");
  const ALLOW = new Set([
    "src/lib/testAccounts.ts", // the QA accounts are @dcica.test by design
    "src/lib/emailAddress.ts", // reserved/undeliverable domains
    "src/lib/mime.ts", // a MIME boundary string
    "src/lib/platform.ts", // the platform's own repository URL
    "src/app/admin/membership/MemberSearch.tsx", // the imported-roster placeholder domain
    // DEFAULT_ORG_SLUG still defaults to the first tenant's slug: local dev and
    // a one-org self-host resolve it with no env at all. Retired at the T11
    // cutover, when every deployed environment names its default explicitly.
    "src/lib/env.ts",
  ]);
  const offenders = walk(join(process.cwd(), "src"))
    .map(rel)
    .filter((p) => !ALLOW.has(p) && !p.startsWith("src/app/api/dev/"))
    .filter((p) => /dcica/i.test(stripComments(readFileSync(join(process.cwd(), p), "utf8"))));
  check("no DCICA literal in app code outside the allowlist", offenders, []);
  check("the deployment's EMAIL_FROM default names no tenant", /EMAIL_FROM[^\n]*DCICA/.test(src("src/lib/env.ts")), false);
  check("send() carries ReplyToAddresses", /ReplyToAddresses/.test(src("src/lib/email.ts")), true);
  check("the confirmation email carries no tenant's hex (its palette comes from the message)", /#0c3543|#f9a200/i.test(src("src/lib/confirmationEmail.ts")), false);
  check("the settings page saves the profile through its own action", /updateOrgProfile/.test(src("src/app/admin/settings/actions.ts")) && /profileSchema/.test(src("src/app/admin/settings/actions.ts")), true);
  check("the contact-address module is gone (it is a profile setting now)", existsSync(join(process.cwd(), "src/lib/contact.ts")), false);
}

async function cleanup(): Promise<void> {
  // Every key this script creates is removed here, most-dependent first, so a
  // run that died halfway leaves nothing behind for the next manual test to
  // trip over. OrgDomain rows cascade from the organisation.
  const org = { slug: { in: [SLUG_A, SLUG_B, SLUG_C] } };
  await db.membership.deleteMany({ where: { user: { email: { in: [STAFF_EMAIL, OTHER_EMAIL, INVITEE_EMAIL] } } } });
  await db.user.deleteMany({ where: { email: { in: [STAFF_EMAIL, OTHER_EMAIL, INVITEE_EMAIL] } } });
  await db.performanceEntry.deleteMany({ where: { org } });
  await db.ledgerEntry.deleteMany({ where: { org } });
  await db.payment.deleteMany({ where: { org } });
  await db.lineItem.deleteMany({ where: { org } });
  await db.attendee.deleteMany({ where: { org } });
  await db.order.deleteMany({ where: { org } });
  await db.volunteerSignup.deleteMany({ where: { event: { org } } });
  await db.volunteerRole.deleteMany({ where: { event: { org } } });
  await db.volunteer.deleteMany({ where: { org } });
  await db.serviceCap.deleteMany({ where: { event: { org } } });
  await db.serviceType.deleteMany({ where: { org } });
  await db.membershipPlan.deleteMany({ where: { org } });
  await db.invite.deleteMany({ where: { org } });
  await db.event.deleteMany({ where: { org } });
  await db.organization.deleteMany({ where: org });
}

async function main(): Promise<void> {
  await section1();
  await section2();
  const fixtures = await section3();
  await section4();
  await section6();
  await section7(fixtures);
  await section9();
  await section10(fixtures);
  await section11();
  await cleanup();
}

main()
  .then(async () => {
    await db.$disconnect();
    console.log(
      failures === 0
        ? `\nAll checks passed. (${passes})\n`
        : `\n${failures} CHECK(S) FAILED. (${passes} passed)\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await cleanup();
    } catch {
      /* best effort */
    }
    await db.$disconnect();
    process.exit(1);
  });
