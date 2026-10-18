import { cache } from "react";
import { notFound } from "next/navigation";
import type { Organization, OrgDomain } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveBranding, type Branding } from "@/lib/branding";
import {
  normalizeHost,
  resolveTenantRequest,
  type TenantLookup,
  type TenantResolution,
} from "@/lib/tenantResolve";
import { orgBaseUrl, platformOrigin } from "@/lib/orgUrl";
import { resolveOrgProfile, resolveOrgSite, type OrgProfile, type OrgSite } from "@/lib/orgSettings";

/**
 * Active-tenant resolution. One deployment serves every organisation, and the
 * organisation comes from the REQUEST: its own hostname (an OrgDomain row), the
 * `/o/<slug>` path the middleware turned into a header, the staff cookie on the
 * platform host, or DEFAULT_ORG_SLUG for a host nobody has claimed. The rules
 * themselves live in src/lib/tenantResolve.ts (pure, shared with middleware);
 * this file supplies the Prisma lookups and the request plumbing.
 *
 * Outside a request — scripts, seeds, the Stripe webhook's post-transaction
 * block — there are no headers to read, so resolution falls straight through
 * to DEFAULT_ORG_SLUG. There is deliberately no "oldest organisation" fallback
 * any more: on a two-org database that served one tenant under the other's
 * name, which is a leak, not a convenience.
 *
 * Callers keep calling `getActiveOrg()` with no arguments; the return type now
 * carries `domains` so every absolute URL can be built from the org (orgUrl.ts).
 */
export type ActiveOrg = Organization & { domains: OrgDomain[] };

/** Request header the middleware sets from a `/o/<slug>` path (and strips if a client sends it). */
export const ORG_SLUG_HEADER = "x-medcamp-org-slug";
/** Staff cookie on the platform host: the organisation this browser works in. */
export const ORG_COOKIE = "medcamp_org";

/** The Prisma side of resolution. Exported so verify-tenant can exercise it without a request. */
export const tenantLookup: TenantLookup<ActiveOrg> = {
  byHost: async (hostname) => {
    const row = await db.orgDomain.findUnique({
      where: { hostname },
      include: { org: { include: { domains: true } } },
    });
    return row?.org ?? null;
  },
  bySlug: (slug) => db.organization.findUnique({ where: { slug }, include: { domains: true } }),
};

/**
 * `headers()` / `cookies()` THROW outside a request scope, and this is reached
 * from scripts and the webhook. The lazy import keeps the module loadable
 * without the Next runtime; the catch turns "no request" into "no input".
 */
async function readRequestTenantInput(): Promise<{
  host: string | null;
  pathSlug: string | null;
  cookieSlug: string | null;
} | null> {
  try {
    const { headers, cookies } = await import("next/headers");
    const h = await headers();
    const c = await cookies();
    return {
      host: normalizeHost(h.get("x-forwarded-host") ?? h.get("host")),
      pathSlug: h.get(ORG_SLUG_HEADER),
      cookieSlug: c.get(ORG_COOKIE)?.value ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolved once per request (`cache` is per-request, so a coordinator saving a
 * setting still sees it on the next render). In script scope `cache` is a
 * passthrough and the lookup simply runs.
 */
export const resolveTenant = cache(async (): Promise<TenantResolution<ActiveOrg>> => {
  const req = await readRequestTenantInput();
  return resolveTenantRequest(
    {
      host: req?.host ?? null,
      pathSlug: req?.pathSlug ?? null,
      cookieSlug: req?.cookieSlug ?? null,
      platformHost: env.PLATFORM_HOST,
      defaultSlug: env.DEFAULT_ORG_SLUG,
    },
    tenantLookup,
  );
});

/**
 * The organisation this request belongs to, or null on the platform host (and
 * on an unknown host with no DEFAULT_ORG_SLUG). A `/o/<slug>` naming no
 * organisation is a 404, raised here so no page can accidentally render a
 * default tenant under a typo.
 */
export const getActiveOrg = cache(async (): Promise<ActiveOrg | null> => {
  const t = await resolveTenant();
  if (t.kind === "not-found") notFound();
  return t.kind === "org" ? t.org : null;
});

/**
 * The active tenant's branding, resolved once per request.
 *
 * Three separate server components need it on every page render — the root
 * layout (CSS variables), SiteHeader (mark + wordmark) and SiteFooter (org
 * name). Reads the non-throwing branch of resolution so the root layout still
 * renders (with the app's defaults) around a 404 for an unknown slug.
 */
export const getActiveBranding = cache(async (): Promise<Branding> => {
  const t = await resolveTenant();
  const org = t.kind === "org" ? t.org : null;
  return resolveBranding(org?.settings, org?.name);
});

/** The active tenant's profile (contact, sender, legal identity). Non-throwing, like branding. */
export const getActiveProfile = cache(async (): Promise<OrgProfile> => {
  const t = await resolveTenant();
  return resolveOrgProfile(t.kind === "org" ? t.org.settings : undefined);
});

/** The active tenant's site settings (analytics ids). Non-throwing, like branding. */
export const getActiveSite = cache(async (): Promise<OrgSite> => {
  const t = await resolveTenant();
  return resolveOrgSite(t.kind === "org" ? t.org.settings : undefined);
});

/** The origin absolute URLs on this request are built from: the org's host, else the platform's. */
export const getActiveOrigin = cache(async (): Promise<string> => {
  const org = await getActiveOrg();
  return org ? orgBaseUrl(org) : platformOrigin();
});
