/**
 * Diwali 2026 Kids Carnival — its own event, on sale from a laptop.
 *
 *   ENV_FILE=<env> npx tsx scripts/setup-diw-carnival.ts                  # dry run
 *   ENV_FILE=<env> npx tsx scripts/setup-diw-carnival.ts --commit         # writes
 *   ENV_FILE=<env> npx tsx scripts/setup-diw-carnival.ts --commit --bulk  # + the 4+ price
 *
 * (PowerShell: `$env:ENV_FILE = "...\.env.prod"` on its own line first.)
 *
 * What it does, idempotently:
 *   1. Creates the CARNIVAL-2026 event — "Diwali Kids Carnival", Oct 24
 *      4:30–8:45 PM at Gerault Park, OPEN, quantity mode, no donation box,
 *      no vendor or volunteer doors — exactly as prisma/seed-events.ts declares
 *      it, so a fresh environment and a hand-configured one agree. An existing
 *      event is left alone: a coordinator's edits are not the script's to undo.
 *   2. Creates the four MERCH catalogue services — Unlimited Rides, Laser Tag,
 *      Rock Wall, All-Access Pass — with the keys /admin/services would derive
 *      (slugify(name)).
 *   3. Attaches each to the carnival event at the banner price (10 / 10 / 5 /
 *      20), no door price, no capacity. With --bulk, also "4 or more of the
 *      SAME ticket" at 8 / 8 / 4 / 16 (ServiceCap.bulkMinQty / bulkPriceCents).
 *   4. Moves any carnival offering that an earlier run attached to DIW-2026
 *      (the festival itself) onto the carnival event — delete there, create
 *      here — but only while nothing has sold on it. A sold offering is left
 *      where it is and named, because money and tickets already point at it.
 *
 * Why its own event: the festival is free entry with a competition fee; the
 * carnival is per-item tickets handed over at a booth (the RON / Dandiya split
 * again). ON THE NIGHT only the carnival event is put through "Start day-of":
 * the scan station picks the ACTIVE event with the earliest start, and DIW-2026
 * starts half an hour earlier with nothing to scan.
 *
 * Needs the `20261018150000_service_cap_bulk_price` migration applied first
 * (the Prisma client knows those two columns, so any offering read fails with
 * P2022 without it): `ENV_FILE=<env> npm run db:migrate:deploy`, additive and
 * safe ahead of the deploy.
 *
 * Prisma model operations only — never raw SQL against a named schema
 * (CLAUDE.md; the pooler does not reliably apply `?schema=`). A remote
 * connection string with no `schema=` is refused before anything is read.
 * Never lowers a capacity, never touches DIW-2026's own offerings, status,
 * dates or mode. A re-run reads "=" on every line and writes nothing.
 */
import * as dotenv from "dotenv";
// `override: true` because this machine has a global DATABASE_URL pointing at
// an unrelated project, and dotenv will not replace an already-set variable.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { Prisma, PrismaClient, type ServiceKind } from "@prisma/client";

const COMMIT = process.argv.includes("--commit");
const BULK = process.argv.includes("--bulk");
const ORG_SLUG = process.env.ORG_SLUG ?? "dcica";
const EVENT_CODE = process.env.EVENT_CODE ?? "CARNIVAL-2026";
/** The festival an earlier run attached the offerings to; moved off it, never edited. */
const FESTIVAL_CODE = process.env.FESTIVAL_CODE ?? "DIW-2026";

/** Mirrors the CARNIVAL-2026 entry in prisma/seed-events.ts. Create-only. */
const EVENT = {
  type: "GENERAL" as const,
  name: "Diwali Kids Carnival",
  // 4:30–8:45 PM CDT (UTC-5) on Oct 24.
  startsAt: new Date("2026-10-24T21:30:00Z"),
  endsAt: new Date("2026-10-25T01:45:00Z"),
  imageUrl: null,
  location: "Gerault Park, Flower Mound, TX",
  description:
    "Kids Carnival at the DCICA Festival of Lights. Unlimited rides $10 (bounce houses, bubble party and lawn games), laser tag $10, rock wall $5, or the All-Access Pass for $20. Buy 4 or more of the same ticket and get 20% off. Buy online or at the carnival booth.",
  offersRegistration: true,
  offersVendors: false,
  offersVolunteers: false,
  collectsAttendeeDetails: false,
  honorsMembership: false,
  acceptsDonations: false,
  allowsRefunds: false,
};

/** Keys equal slugify(name) exactly as src/app/admin/services/actions.ts derives them. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const ITEMS: {
  name: string;
  colorHex: string;
  priceCents: number;
  kind: ServiceKind;
  /** The 4+ break: from this many units of THIS item on one line, each costs this. */
  bulkMinQty: number;
  bulkPriceCents: number;
}[] = [
  { name: "Unlimited Rides", colorHex: "#f97316", priceCents: 1000, kind: "MERCH", bulkMinQty: 4, bulkPriceCents: 800 },
  { name: "Laser Tag", colorHex: "#8b5cf6", priceCents: 1000, kind: "MERCH", bulkMinQty: 4, bulkPriceCents: 800 },
  { name: "Rock Wall", colorHex: "#10b981", priceCents: 500, kind: "MERCH", bulkMinQty: 4, bulkPriceCents: 400 },
  { name: "All-Access Pass", colorHex: "#eab308", priceCents: 2000, kind: "MERCH", bulkMinQty: 4, bulkPriceCents: 1600 },
];

/**
 * The same refusal prisma/migrate-deploy.ts makes: a remote connection string
 * with no `schema=` lands in `public`, which is how this project once grew four
 * copies of itself. Localhost is exempt — a throwaway Docker Postgres IS public.
 */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error(`DATABASE_URL is not set (ENV_FILE=${process.env.ENV_FILE ?? ".env"}).`);
  const url = new URL(raw);
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname);
  const schema = url.searchParams.get("schema");
  if (!local && !schema) {
    throw new Error("DATABASE_URL points at a remote host and names no schema — refusing.");
  }
  return `${url.hostname}${url.pathname}  schema=${schema ?? "(local default)"}`;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const CAP_SELECT = {
  id: true,
  priceCents: true,
  onsitePriceCents: true,
  capacity: true,
  sold: true,
  bulkMinQty: true,
  bulkPriceCents: true,
} as const;

async function main(): Promise<void> {
  const target = describeTarget();
  const db = new PrismaClient();
  try {
    console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"}${BULK ? " + 4+ price" : ""}  ${target}`);
    console.log(`  org ${ORG_SLUG}   event ${EVENT_CODE}   (moving off ${FESTIVAL_CODE} if found)\n`);

    const org = await db.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } });
    if (!org) throw new Error(`No organization with slug ${ORG_SLUG}.`);

    type Plan = { line: string; apply: () => Promise<void> };
    const plan: Plan[] = [];
    let changes = 0;

    // ── 1. The event ───────────────────────────────────────────────────────
    const existingEvent = await db.event.findFirst({
      where: { orgId: org.id, code: EVENT_CODE },
      select: { id: true, name: true, status: true, collectsAttendeeDetails: true },
    });
    let eventId = existingEvent?.id ?? null;
    if (existingEvent) {
      plan.push({
        line: `  = event    ${EVENT_CODE.padEnd(16)} ${existingEvent.name}, ${existingEvent.status}, ${existingEvent.collectsAttendeeDetails ? "ATTENDEE" : "QUANTITY"} mode (left as the coordinator has it)`,
        apply: async () => {},
      });
    } else {
      changes++;
      plan.push({
        line: `  + event    ${EVENT_CODE.padEnd(16)} ${EVENT.name}, OPEN, QUANTITY mode, Oct 24 4:30–8:45 PM, no poster yet`,
        apply: async () => {
          const created = await db.event.create({
            data: { orgId: org.id, code: EVENT_CODE, status: "OPEN", ...EVENT },
            select: { id: true },
          });
          eventId = created.id;
        },
      });
    }

    const festival = await db.event.findFirst({
      where: { orgId: org.id, code: FESTIVAL_CODE },
      select: { id: true },
    });

    // ── 2. Services, 3. offerings on the carnival, 4. moves off the festival ──
    for (const item of ITEMS) {
      const key = slugify(item.name);
      const existing = await db.serviceType.findUnique({
        where: { orgId_key: { orgId: org.id, key } },
        select: { id: true, name: true, kind: true, active: true },
      });
      let serviceTypeId = existing?.id ?? null;
      if (!existing) {
        changes++;
        plan.push({
          line: `  + service  ${key.padEnd(16)} ${item.name} (${item.kind}, ${item.colorHex})`,
          apply: async () => {
            const created = await db.serviceType.create({
              data: {
                orgId: org.id,
                key,
                name: item.name,
                priceCents: item.priceCents,
                colorHex: item.colorHex,
                kind: item.kind,
                admitsCount: 1,
                active: true,
              },
              select: { id: true },
            });
            serviceTypeId = created.id;
          },
        });
      } else if (existing.kind !== item.kind || !existing.active) {
        changes++;
        plan.push({
          line: `  ~ service  ${key.padEnd(16)} kind ${existing.kind}→${item.kind}, active→true`,
          apply: async () => {
            await db.serviceType.update({
              where: { id: existing.id },
              data: { kind: item.kind, active: true, admitsCount: 1 },
            });
          },
        });
      } else {
        plan.push({ line: `  = service  ${key.padEnd(16)} ${existing.name}`, apply: async () => {} });
      }

      // The offering an earlier run attached to the festival itself.
      const stray =
        existing && festival
          ? await db.serviceCap.findUnique({
              where: { eventId_serviceTypeId: { eventId: festival.id, serviceTypeId: existing.id } },
              select: { id: true, sold: true },
            })
          : null;
      if (stray) {
        if (stray.sold === 0) {
          changes++;
          plan.push({
            line: `  - offering ${key.padEnd(16)} removed from ${FESTIVAL_CODE} (nothing sold there; it belongs on the carnival)`,
            apply: async () => {
              await db.serviceCap.delete({ where: { id: stray.id }, select: { id: true } });
            },
          });
        } else {
          plan.push({
            line: `  ! offering ${key.padEnd(16)} stays on ${FESTIVAL_CODE}: ${stray.sold} sold there, so money and tickets already point at it`,
            apply: async () => {},
          });
        }
      }

      const cap =
        existing && eventId
          ? await db.serviceCap.findUnique({
              where: { eventId_serviceTypeId: { eventId, serviceTypeId: existing.id } },
              select: CAP_SELECT,
            })
          : null;
      if (!cap) {
        changes++;
        const bulkNote = BULK ? `, ${item.bulkMinQty}+ at ${usd(item.bulkPriceCents)} each` : "";
        plan.push({
          line: `  + offering ${key.padEnd(16)} ${usd(item.priceCents)} online and at the booth, uncapped${bulkNote}`,
          apply: async () => {
            if (!serviceTypeId || !eventId) throw new Error(`service or event for ${key} was not created`);
            await db.serviceCap.create({
              data: {
                eventId,
                serviceTypeId,
                priceCents: item.priceCents,
                onsitePriceCents: null,
                capacity: null,
                ...(BULK ? { bulkMinQty: item.bulkMinQty, bulkPriceCents: item.bulkPriceCents } : {}),
              },
              select: { id: true },
            });
          },
        });
      } else {
        const drift: string[] = [];
        if (cap.priceCents !== item.priceCents) drift.push(`price ${usd(cap.priceCents)}→${usd(item.priceCents)}`);
        const bulkDrift =
          BULK && (cap.bulkMinQty !== item.bulkMinQty || cap.bulkPriceCents !== item.bulkPriceCents);
        if (bulkDrift) {
          const was =
            cap.bulkMinQty !== null && cap.bulkPriceCents !== null
              ? `${cap.bulkMinQty}+ at ${usd(cap.bulkPriceCents)}`
              : "none";
          drift.push(`4+ price ${was}→${item.bulkMinQty}+ at ${usd(item.bulkPriceCents)} each`);
        }
        const bulkNow =
          cap.bulkMinQty !== null && cap.bulkPriceCents !== null
            ? `, ${cap.bulkMinQty}+ at ${usd(cap.bulkPriceCents)} each`
            : "";
        if (drift.length > 0) {
          changes++;
          plan.push({
            line: `  ~ offering ${key.padEnd(16)} ${drift.join(", ")} (capacity ${cap.capacity ?? "unlimited"}, ${cap.sold} sold, untouched)`,
            apply: async () => {
              await db.serviceCap.update({
                where: { id: cap.id },
                data: {
                  priceCents: item.priceCents,
                  ...(BULK ? { bulkMinQty: item.bulkMinQty, bulkPriceCents: item.bulkPriceCents } : {}),
                },
                select: { id: true },
              });
            },
          });
        } else {
          plan.push({
            line: `  = offering ${key.padEnd(16)} ${usd(cap.priceCents)}${cap.onsitePriceCents !== null ? ` (door ${usd(cap.onsitePriceCents)})` : ""}, capacity ${cap.capacity ?? "unlimited"}, ${cap.sold} sold${bulkNow}`,
            apply: async () => {},
          });
        }
      }
    }

    console.log("");
    for (const p of plan) console.log(p.line);
    console.log(`\n  ${changes} change(s)`);

    if (!COMMIT) {
      console.log(`\nDry run only. Re-run with --commit to write.\n`);
      return;
    }
    if (changes === 0) {
      console.log(`\nNothing to write.\n`);
      return;
    }
    for (const p of plan) await p.apply();
    console.log(`\nWritten. Re-run without --commit to see every line read "=".\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022") {
    console.error(
      `\nThe database lacks a column this client expects (${err.message.split("\n").pop()}).\n` +
        `Apply the pending migration first: ENV_FILE=<env> npm run db:migrate:deploy\n`,
    );
  } else {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = 1;
});
