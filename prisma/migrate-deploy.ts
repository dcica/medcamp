import { config } from "dotenv";
// Load the chosen env file BEFORE invoking the Prisma CLI so migrate deploy
// targets the right DB. ENV_FILE overrides which file is loaded (default .env);
// set ENV_FILE=.env.test to apply migrations to the deployed test DB. Mirrors the
// dotenv pattern in the seed scripts so migrate + seed share one mechanism.
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { execSync } from "node:child_process";

// Prisma migrations connect via datasource.directUrl (DIRECT_URL) — make sure
// that's the DIRECT (5432) connection, not the pooled/pgbouncer one.
execSync("npx prisma migrate deploy", { stdio: "inherit" });
