/**
 * Pure tenant resolution. No Prisma, no `next/headers`: this file is imported
 * by the edge middleware AND by `getActiveOrg()` on the server, so the single
 * rule set lives here and both consumers agree by construction.
 *
 * Order of precedence, settled 2026-10-18:
 *
 *   1. Host header → a row in `OrgDomain` → that organisation. A `/o/<slug>`
 *      path naming a DIFFERENT organisation on a tenant host is not found —
 *      a tenant's domain never serves another tenant.
 *   2. `/o/<slug>` path → that organisation, or not found. Never a redirect
 *      and never a fallback: a typo must look like a typo.
 *   3. The platform host with nothing else → none (it has no default tenant;
 *      staff pick one). The `medcamp_org` cookie is consulted only here.
 *   4. An unknown host (a preview alias, a domain attached before its row was
 *      seeded, a self-hoster's first boot) → DEFAULT_ORG_SLUG, or none.
 *
 * What is deliberately absent: "the oldest organisation in the database".
 * That was the fallback until 2026-10 and it serves one tenant's site under
 * the other tenant's name the moment a second row exists.
 */

export type TenantVia = "host" | "path" | "cookie" | "default";

export type TenantResolution<O> =
  | { kind: "org"; org: O; via: TenantVia }
  | { kind: "none" }
  | { kind: "not-found"; slug: string };

export type TenantRequestInput = {
  /** Already-normalised host, or null outside a request (scripts, webhooks). */
  host: string | null;
  /** Slug carried on the `/o/<slug>` path, if any. */
  pathSlug: string | null;
  /** The staff cookie, if any. Only honoured on the platform host. */
  cookieSlug: string | null;
  /** PLATFORM_HOST (bare hostname), if configured. */
  platformHost: string | undefined;
  /** DEFAULT_ORG_SLUG, if configured. */
  defaultSlug: string | undefined;
};

export type TenantLookup<O> = {
  byHost: (hostname: string) => Promise<O | null>;
  bySlug: (slug: string) => Promise<O | null>;
};

/**
 * `Host` / `X-Forwarded-Host` → a comparable hostname: first entry of a comma
 * list, lowercase, no port, no trailing dot. Null for nothing usable.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return null;
  let host = first;
  if (host.startsWith("[")) {
    // Bracketed IPv6 literal: keep the brackets, drop any port after them.
    const close = host.indexOf("]");
    host = close === -1 ? host : host.slice(0, close + 1);
  } else {
    const colon = host.indexOf(":");
    if (colon !== -1) host = host.slice(0, colon);
  }
  host = host.replace(/\.+$/, "");
  return host || null;
}

/** `/o/<slug>` and `/o/<slug>/rest`. Slug charset is the same as Organization.slug. */
const ORG_PATH_RE = /^\/o\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;

export function parseOrgPath(pathname: string): { slug: string; rest: string } | null {
  const m = ORG_PATH_RE.exec(pathname);
  if (!m) return null;
  const rest = m[2] && m[2] !== "/" ? m[2] : "/";
  return { slug: m[1], rest };
}

export async function resolveTenantRequest<O extends { slug: string }>(
  input: TenantRequestInput,
  lookup: TenantLookup<O>,
): Promise<TenantResolution<O>> {
  const { host, pathSlug, cookieSlug, defaultSlug } = input;
  const platformHost = normalizeHost(input.platformHost);

  // 1. A tenant's own domain.
  if (host) {
    const byHost = await lookup.byHost(host);
    if (byHost) {
      if (pathSlug && pathSlug !== byHost.slug) {
        return { kind: "not-found", slug: pathSlug };
      }
      return { kind: "org", org: byHost, via: "host" };
    }
  }

  // 2. The path names the organisation.
  if (pathSlug) {
    const org = await lookup.bySlug(pathSlug);
    return org ? { kind: "org", org, via: "path" } : { kind: "not-found", slug: pathSlug };
  }

  // 3. The platform host never defaults; the staff cookie may choose.
  if (platformHost && host === platformHost) {
    if (cookieSlug) {
      const org = await lookup.bySlug(cookieSlug);
      if (org) return { kind: "org", org, via: "cookie" };
    }
    return { kind: "none" };
  }

  // 4. Unknown host, or no request at all.
  if (defaultSlug) {
    const org = await lookup.bySlug(defaultSlug);
    if (org) return { kind: "org", org, via: "default" };
  }
  return { kind: "none" };
}
