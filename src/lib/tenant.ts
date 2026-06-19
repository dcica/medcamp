import { db } from "@/lib/db";
import { env } from "@/lib/env";

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
