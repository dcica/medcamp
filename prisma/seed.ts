import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed always targets the env
// file's DB, not a global var from another project. ENV_FILE overrides which
// file is loaded (e.g. ENV_FILE=.env.test to seed the deployed test DB).
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { PrismaClient } from "@prisma/client";
import { ORG_SEEDS } from "./orgs";
import { seedOrg } from "./orgs/seedOrg";
import { SEED_ENVS, type SeedEnv } from "./orgs/types";

const db = new PrismaClient();

/**
 * Provisions every TENANT: the organisation row, its service catalogue, its
 * membership plans, its hostnames for this environment and its first-admin
 * invites. One deployment serves every organisation, so one database holds
 * every module under prisma/orgs — a new tenant is a new module there.
 *
 * Nothing time-bound — no events, and therefore no capacity caps, stations or
 * volunteer roles, all of which hang off an event. Events come from
 * seed-events.ts (the real published lineup) and seed-test.ts (throwaway QA
 * fixtures), so a fresh production database comes up with its tenants and no
 * invented calendar.
 *
 *   SEED_ENV   development | test | production — which hostnames to write.
 *              Defaults to development (no hostnames; localhost resolves
 *              DEFAULT_ORG_SLUG). CI sets it per job.
 *   SEED_ORGS  comma-separated slugs to narrow to; every module by default.
 *
 * Each module runs on its own: a red one is reported and fails the run at the
 * end, but the modules before it stay committed. dcica is first.
 */
async function main() {
  const env = process.env.SEED_ENV ?? "development";
  if (!SEED_ENVS.includes(env as SeedEnv)) {
    throw new Error(`SEED_ENV must be one of ${SEED_ENVS.join(", ")}; got ${JSON.stringify(env)}`);
  }
  const only = process.env.SEED_ORGS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (only) {
    const known = new Set(ORG_SEEDS.map((o) => o.slug));
    const unknown = only.filter((s) => !known.has(s));
    if (unknown.length) throw new Error(`SEED_ORGS names no module: ${unknown.join(", ")}`);
  }
  const modules = only ? ORG_SEEDS.filter((o) => only.includes(o.slug)) : ORG_SEEDS;

  let failed = 0;
  for (const seed of modules) {
    try {
      await seedOrg(db, seed, env as SeedEnv);
      console.log(
        `Seeded org ${seed.slug} for ${env} (${seed.services.length} service types, ` +
          `${seed.membershipPlans.length} membership plans, ` +
          `${seed.domains[env as SeedEnv].length} hostnames, no events).`,
      );
    } catch (err) {
      failed += 1;
      console.error(`Seed FAILED for org ${seed.slug}:`, err);
    }
  }
  if (failed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
