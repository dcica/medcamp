import { config } from "dotenv";
// Load the chosen env file BEFORE invoking the Prisma CLI so migrate deploy
// targets the right DB. ENV_FILE overrides which file is loaded (default .env);
// set ENV_FILE=.env.test to apply migrations to the deployed test DB. Mirrors the
// dotenv pattern in the seed scripts so migrate + seed share one mechanism.
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { execSync } from "node:child_process";

/**
 * A schema-less connection string does not fail — it silently migrates into
 * `public`. That is how this project ended up with FOUR full copies of itself in
 * one Supabase instance (`public`, `dev`, `staging` beside the real `test` and
 * `prod`); the `public` copy sat reachable by the browser-published `anon` role
 * with RLS off and 352 rows of real PII in it until 2026-08-22. The URL is the
 * only thing that states which tenant schema is about to be written, so it gets
 * checked rather than trusted.
 *
 * Localhost is exempt on purpose: local dev is a throwaway Docker Postgres whose
 * own database IS `public`, with nothing to collide with.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parse(name: string): { local: boolean; schema: string | null } {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `${name} is not set. ENV_FILE=${process.env.ENV_FILE ?? ".env"} loaded no ` +
        `value for it — check that the env file exists and defines it.`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Nearly always a raw special character in the password (see the P1013 note
    // in docs/Deployment.md). Say so rather than surfacing a parser error.
    throw new Error(
      `${name} is not a parseable URL. A literal special character in the ` +
        `password is the usual cause — use an alphanumeric one.`,
    );
  }
  return {
    local: LOCAL_HOSTS.has(url.hostname),
    schema: url.searchParams.get("schema"),
  };
}

const db = parse("DATABASE_URL");
const direct = parse("DIRECT_URL");

if (!db.local || !direct.local) {
  for (const [name, u] of [
    ["DATABASE_URL", db],
    ["DIRECT_URL", direct],
  ] as const) {
    if (u.local) continue;
    if (!u.schema) {
      throw new Error(
        `${name} names no schema, and it points at a remote host. Migrating ` +
          `would build a stray copy of every table in \`public\`. Append ` +
          `\`&schema=<env>\` (pooled) or \`?schema=<env>\` (direct) and re-run.`,
      );
    }
  }
  // A mismatch migrates one schema while the app reads another — the failure
  // then looks like a missing column at runtime, far from its cause.
  if (db.schema !== direct.schema) {
    throw new Error(
      `DATABASE_URL targets schema \`${db.schema}\` but DIRECT_URL targets ` +
        `\`${direct.schema}\`. Migrations would land in one and the app read ` +
        `the other. Make them agree.`,
    );
  }
  console.log(`migrate target: schema \`${direct.schema}\``);
}

// Prisma migrations connect via datasource.directUrl (DIRECT_URL) — make sure
// that's the DIRECT (5432) connection, not the pooled/pgbouncer one.
execSync("npx prisma migrate deploy", { stdio: "inherit" });
