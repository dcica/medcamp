import type { Role, ServiceKind } from "@prisma/client";

/**
 * One tenant, as configuration. `db:seed` runs every module under prisma/orgs
 * through `seedOrg`; a new organisation is a new module and nothing else —
 * no fork, no code path per tenant (Platform-Mandate §6, configuration over
 * code).
 *
 * `domains` is per deployment environment because a hostname is a fact about
 * a deployment, not about the organisation: dcica answers on
 * `events.dcica.org` in production and `test.dcica.org` on test, and on a
 * developer's machine on nothing at all (localhost resolves DEFAULT_ORG_SLUG).
 * The first hostname listed for an environment is the primary — the one every
 * absolute URL for the organisation is built on.
 */
export type SeedEnv = "development" | "test" | "production";

export const SEED_ENVS: readonly SeedEnv[] = ["development", "test", "production"];

export type OrgSeed = {
  slug: string;
  name: string;
  /** The `Organization.settings` blob: a full `theme` (validated at seed time), `locale`, `seo`, … */
  settings: Record<string, unknown> & { theme: Record<string, unknown> };
  services: {
    key: string;
    name: string;
    priceCents: number;
    kind: ServiceKind;
    colorHex?: string;
    hasLab?: boolean;
    /** Heads one unit admits — 1 for a single, 2 for a doubles entry, 8 for a table. */
    admitsCount?: number;
  }[];
  membershipPlans: {
    key: string;
    name: string;
    termYears: number;
    priceCents: number;
    partySize: number;
  }[];
  /** First-admin invites, accepted on sign-in by src/lib/auth.ts. */
  invites: { email: string; role: Role }[];
  domains: Record<SeedEnv, string[]>;
};
