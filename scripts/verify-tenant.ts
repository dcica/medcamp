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

async function section3(): Promise<void> {
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

  await cleanup();
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

async function cleanup(): Promise<void> {
  // OrgDomain rows cascade from the organisation.
  await db.organization.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

async function main(): Promise<void> {
  await section1();
  await section2();
  await section3();
  await section4();
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
