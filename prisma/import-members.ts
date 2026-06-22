import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the import targets the env file's DB.
// ENV_FILE overrides which file is loaded (e.g. ENV_FILE=.env.test for the test DB).
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Imports the consolidated DCICA family-membership roster into the dcica org.
 *
 * Source is a cleaned, deduped JSON produced from the historical member
 * spreadsheets (see scripts/normalize-members.py). The spreadsheets carry real
 * PII (names / emails / phones) and are NEVER committed — pass the JSON path on
 * the command line. Idempotent: upserts by the [orgId, email] unique key, so
 * re-running updates in place rather than duplicating.
 *
 *   MEMBERS_JSON=/path/to/dcica-members-clean.json npm run db:import:members
 *   # or: tsx prisma/import-members.ts /path/to/dcica-members-clean.json
 *
 * Records carry no plan link (planId = null): the historical amounts don't map
 * to the current 1/2/5-year catalogue, and membership-comp at the gate keys off
 * validTo, not the plan. LIFE members get validTo 2099-12-31.
 */

type CleanMember = {
  name: string;
  email: string;
  phone: string | null;
  partySize: number | null;
  isLife: boolean;
  validFrom: string | null; // ISO date
  validTo: string | null; // ISO date
  emailSynthesized: boolean;
};

const DEFAULT_PARTY_SIZE = 4;
// Floor for rows where neither Membership To nor a Good-Standing year was
// derivable — kept distinct from a real expiry so they're easy to find/fix.
const UNKNOWN_VALID_TO = new Date("2000-12-31");

async function main() {
  const jsonPath = process.argv[2] ?? process.env.MEMBERS_JSON;
  if (!jsonPath) {
    throw new Error(
      "No source JSON. Pass a path: tsx prisma/import-members.ts <clean.json> (or set MEMBERS_JSON).",
    );
  }
  const records: CleanMember[] = JSON.parse(readFileSync(jsonPath, "utf8"));

  const org = await db.organization.findUnique({ where: { slug: "dcica" } });
  if (!org) throw new Error("Org 'dcica' not found — run `npm run db:seed` first.");

  let created = 0;
  let updated = 0;
  let current = 0;
  const now = Date.now();

  for (const r of records) {
    const validTo = r.validTo ? new Date(r.validTo) : UNKNOWN_VALID_TO;
    const validFrom = r.validFrom ? new Date(r.validFrom) : validTo;
    if (r.isLife || validTo.getTime() >= now) current++;

    const data = {
      name: r.name,
      phone: r.phone,
      partySize: r.partySize ?? DEFAULT_PARTY_SIZE,
      validFrom,
      validTo,
      planId: null,
    };

    const existing = await db.member.findUnique({
      where: { orgId_email: { orgId: org.id, email: r.email } },
    });
    await db.member.upsert({
      where: { orgId_email: { orgId: org.id, email: r.email } },
      update: data,
      create: { orgId: org.id, email: r.email, ...data },
    });
    existing ? updated++ : created++;
  }

  console.log(
    `Imported ${records.length} families into org dcica: ${created} created, ${updated} updated, ${current} currently valid.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
