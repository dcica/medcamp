import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed always targets the env
// file's DB, not a global var from another project. ENV_FILE overrides which
// file is loaded (e.g. ENV_FILE=.env.test to seed the deployed test DB).
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Seeds the DCICA reference tenant: the organisation row and its service menu.
 * Nothing time-bound — no events, and therefore no capacity caps, stations or
 * volunteer roles, all of which hang off an event. Everything here is
 * config-over-code — a second tenant would seed its own rows, not fork code.
 */
async function main() {
  const org = await db.organization.upsert({
    where: { slug: "dcica" },
    update: {},
    create: {
      slug: "dcica",
      name: "DCICA",
      settings: { brand: "#0d6e6e", locale: "en" },
    },
  });

  // ── Service menu ──
  const services = [
    { key: "vision", name: "Vision Screening", priceCents: 1500, colorHex: "#2563eb", hasLab: false },
    { key: "dental", name: "Dental Check", priceCents: 2000, colorHex: "#16a34a", hasLab: false },
    { key: "bloodwork", name: "Bloodwork", priceCents: 3500, colorHex: "#dc2626", hasLab: true },
    { key: "general", name: "General Consult", priceCents: 0, colorHex: "#7c3aed", hasLab: false },
  ];

  for (const s of services) {
    await db.serviceType.upsert({
      where: { orgId_key: { orgId: org.id, key: s.key } },
      update: { name: s.name, priceCents: s.priceCents, colorHex: s.colorHex, hasLab: s.hasLab },
      create: { orgId: org.id, ...s },
    });
  }

  // No event is seeded here on purpose. This file provisions the TENANT —
  // the org and its service catalogue — and nothing that is a specific thing
  // happening on a specific day. Events come from seed-events.ts (the real
  // published lineup) and seed-test.ts (throwaway QA fixtures), so a fresh
  // production database comes up with a tenant and no invented calendar.
  //
  // This used to create a sample camp MC-2026W plus its capacity caps, Care
  // Spine stations and volunteer roles. Because CI runs db:seed on every push,
  // that sample kept reappearing in production as a real-looking event. When a
  // genuine medical camp is scheduled, add it to seed-events.ts or create it in
  // the admin UI; the per-event stations and roles are seeded from there.

  console.log(`Seeded org ${org.slug} (${services.length} service types, no events).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
