import { cache } from "react";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveBranding, type Branding } from "@/lib/branding";

/**
 * Active-tenant resolution seam (Approach C). For now there is one tenant and
 * it's resolved by slug (DEFAULT_ORG_SLUG), falling back to the only org in the
 * DB. When multi-tenancy lands, this is where subdomain/path routing resolves
 * the request's org — callers don't change.
 */
export async function getActiveOrg() {
  const bySlug = await db.organization.findUnique({
    where: { slug: env.DEFAULT_ORG_SLUG },
  });
  if (bySlug) return bySlug;
  // Fallback: single-tenant deployments where the slug wasn't configured.
  return db.organization.findFirst({ orderBy: { createdAt: "asc" } });
}

/**
 * The active tenant's branding, resolved once per request.
 *
 * Wrapped in React `cache` because three separate server components need it on
 * every single page render — the root layout (to emit the CSS variables),
 * SiteHeader (mark + wordmark) and SiteFooter (org name). Without the cache that
 * is three identical queries per request on 38 routes; with it, one. `cache` is
 * per-request, so a coordinator saving a theme still sees it on the next render.
 *
 * `getActiveOrg()` can legitimately return null — the slug is unconfigured and
 * the database has no organization row at all, i.e. a self-hoster's first boot.
 * `resolveBranding` treats that like every other missing input and hands back
 * the app's own defaults, so the site renders rather than 500s.
 */
export const getActiveBranding = cache(async (): Promise<Branding> => {
  const org = await getActiveOrg();
  return resolveBranding(org?.settings, org?.name);
});
