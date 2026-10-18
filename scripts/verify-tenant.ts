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
 * serves one tenant's site under the other tenant's name. §1 pins the pure
 * resolver so that rule cannot drift back in.
 *
 * §1 needs no database: the resolver is a pure function with injected lookups.
 */

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

async function main(): Promise<void> {
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

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\nAll checks passed. (${passes})\n`
        : `\n${failures} CHECK(S) FAILED. (${passes} passed)\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
