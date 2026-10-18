/**
 * Switch an organisation's platform service fee on, off, or re-shape it.
 *
 *   ENV_FILE=.env ORG_SLUG=infinite-minds POLICY=default npx tsx scripts/set-fee-policy.ts             # dry run
 *   ENV_FILE=.env ORG_SLUG=infinite-minds POLICY=default npx tsx scripts/set-fee-policy.ts --commit    # writes
 *   ENV_FILE=.env ORG_SLUG=infinite-minds POLICY=default PAYER=absorb COVER_DEFAULT=off ... --commit
 *   ENV_FILE=.env ORG_SLUG=infinite-minds POLICY=off npx tsx scripts/set-fee-policy.ts --commit        # zero fee
 *
 *   POLICY         default | off            (required)
 *   PAYER          buyer | absorb           (optional; default buyer)
 *   ALLOW_COVER    on | off                 (optional; default on)
 *   COVER_DEFAULT  on | off                 (optional; default on — whether the cover box starts ticked)
 *
 * A PLATFORM-OPERATOR action, deliberately absent from the tenant's settings
 * screen: a tenant must not be able to set its own fee to zero. The choices a
 * tenant may make — absorbing the fee, whether the cover box starts ticked —
 * are the flags above, set on its behalf.
 *
 * No stored policy means NO fee (src/lib/fees.ts), which is how every
 * organisation starts and how the first tenant stays. The fee only ever
 * reaches a buyer through a Stripe Checkout on a CONNECTED account; cash,
 * Zelle, check and comped orders never carry it whatever is stored here.
 *
 * PRISMA MODEL OP, NEVER RAW SQL — see the note in src/server/payments.ts.
 * Writes with the spread-and-replace-one-key pattern the settings actions
 * use, so the theme, profile, site and legal blocks beside `fees` survive.
 */
import * as dotenv from "dotenv";
import { PrismaClient, type Prisma } from "@prisma/client";

dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

const ORG_SLUG = process.env.ORG_SLUG ?? "";
const POLICY = process.env.POLICY ?? "";
const PAYER = process.env.PAYER ?? "buyer";
const ALLOW_COVER = process.env.ALLOW_COVER ?? "on";
const COVER_DEFAULT = process.env.COVER_DEFAULT ?? "on";

function onOff(v: string, name: string): boolean {
  if (v !== "on" && v !== "off") throw new Error(`${name} must be on or off`);
  return v === "on";
}

async function main() {
  const { DEFAULT_FEE_POLICY, feePolicySchema, readFeePolicy, computeOrderFees } = await import("../src/lib/fees");

  if (!ORG_SLUG || (POLICY !== "default" && POLICY !== "off")) {
    console.log("Set ORG_SLUG and POLICY=default|off.");
    process.exitCode = 1;
    return;
  }
  if (PAYER !== "buyer" && PAYER !== "absorb") {
    console.log("PAYER must be buyer or absorb.");
    process.exitCode = 1;
    return;
  }

  const org = await db.organization.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, slug: true, name: true, settings: true, stripeAccountId: true, stripeChargesEnabled: true },
  });
  if (!org) {
    console.log(`No organisation with slug "${ORG_SLUG}".`);
    process.exitCode = 1;
    return;
  }

  const before = readFeePolicy(org.settings);
  const next =
    POLICY === "off"
      ? null
      : feePolicySchema.parse({
          ...DEFAULT_FEE_POLICY,
          payer: PAYER,
          allowBuyerCover: onOff(ALLOW_COVER, "ALLOW_COVER"),
          feeCoverDefaultChecked: onOff(COVER_DEFAULT, "COVER_DEFAULT"),
        });

  console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"} — set-fee-policy`);
  console.log(`  ${org.slug}  ${org.name}`);
  console.log(
    `  connected account: ${org.stripeAccountId ?? "none (the fee can never reach a buyer until one is connected)"}` +
      (org.stripeAccountId ? `  charges ${org.stripeChargesEnabled ? "enabled" : "NOT enabled"}` : ""),
  );
  console.log(`  before: ${before.kind}${before.kind === "unreadable" ? ` (${before.reason})` : ""}`);
  console.log(`  after:  ${next ? "ok" : "none (zero fee)"}`);
  if (next) {
    console.log(
      `    tickets ${next.tickets.percentBps / 100}% + ${next.tickets.fixedCents}¢` +
        `${next.tickets.capCents !== null ? `, cap $${(next.tickets.capCents / 100).toFixed(2)}` : ""}` +
        `; donations ${next.donations.percentBps / 100}% + ${next.donations.fixedCents}¢` +
        `; payer ${next.payer}; cover ${next.allowBuyerCover ? (next.feeCoverDefaultChecked ? "offered, starts ticked" : "offered, starts clear") : "not offered"}`,
    );
    const ex = computeOrderFees([{ amountCents: 4000, quantity: 1 }], next, { coverProcessing: true, orgName: org.name });
    console.log(
      `    e.g. a $40 ticket: fee $${(ex.platformFeeCents / 100).toFixed(2)}` +
        `${next.payer === "buyer" ? `, buyer pays $${((ex.subtotalCents + ex.buyerFeeCents) / 100).toFixed(2)}` : ", absorbed"}` +
        `${next.allowBuyerCover ? `, $${(ex.totalCents / 100).toFixed(2)} with the cover` : ""}`,
    );
  }

  if (!COMMIT) {
    console.log(`\nDry run only. Re-run with --commit to write.`);
    return;
  }

  const current =
    org.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
      ? (org.settings as Record<string, unknown>)
      : {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fees: _dropped, ...rest } = current;
  const settings = next ? { ...rest, fees: next } : rest;

  await db.organization.update({
    where: { id: org.id },
    data: { settings: settings as Prisma.InputJsonObject },
  });

  const after = await db.organization.findUniqueOrThrow({ where: { id: org.id }, select: { settings: true } });
  const stored = readFeePolicy(after.settings);
  const ok = next ? stored.kind === "ok" : stored.kind === "none";
  console.log(`  ${ok ? "ok  " : "FAIL"}  stored policy now reads: ${stored.kind}`);
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
