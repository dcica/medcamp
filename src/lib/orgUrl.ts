import { env } from "@/lib/env";
import { isLocalHost } from "@/lib/tenantResolve";

export { isLocalHost };

/**
 * Where an organisation's absolute URLs are built from. Every Stripe return
 * URL, every email link, every canonical and sitemap entry goes through
 * `orgBaseUrl`, so that a tenant's links carry the tenant's own host and
 * never a global env value — the webhook builds email links with no request
 * in scope, which is exactly why this takes the organisation, not a request.
 *
 *   1. the organisation's primary domain (or its only domain)
 *   2. `/o/<slug>` on the platform host, when the organisation has no domain
 *   3. the fallback origin (NEXT_PUBLIC_APP_URL): bare for the default slug,
 *      `/o/<slug>` for any other — local dev and a self-hoster's first boot
 */
export type OrgUrlInput = {
  slug: string;
  domains: { hostname: string; isPrimary: boolean }[];
};

export type OrgUrlConfig = {
  platformHost: string | undefined;
  fallbackOrigin: string;
  defaultSlug: string | undefined;
};

function configFromEnv(): OrgUrlConfig {
  return {
    platformHost: env.PLATFORM_HOST,
    fallbackOrigin: env.NEXT_PUBLIC_APP_URL,
    defaultSlug: env.DEFAULT_ORG_SLUG,
  };
}

function originFor(hostname: string): string {
  return `${isLocalHost(hostname) ? "http" : "https"}://${hostname}`;
}

function stripSlash(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function orgBaseUrl(org: OrgUrlInput, cfg: OrgUrlConfig = configFromEnv()): string {
  const primary = org.domains.find((d) => d.isPrimary) ?? org.domains[0];
  if (primary) return originFor(primary.hostname);
  if (cfg.platformHost) return `https://${cfg.platformHost}/o/${org.slug}`;
  const origin = stripSlash(cfg.fallbackOrigin);
  return org.slug === cfg.defaultSlug ? origin : `${origin}/o/${org.slug}`;
}

/** The platform host's own origin — staff sign-in, and the home of tenants without a domain. */
export function platformOrigin(cfg: OrgUrlConfig = configFromEnv()): string {
  return cfg.platformHost ? `https://${cfg.platformHost}` : stripSlash(cfg.fallbackOrigin);
}
