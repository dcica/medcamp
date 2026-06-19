import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed always targets this
// project's .env DB, not a global var from another project on the machine.
config({ override: true });

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Seeds the dcica reference tenant: one org, a sample winter camp, the service
 * menu, capacity caps, and the default Care Spine stations. Everything here is
 * config-over-code — a second tenant would seed its own rows, not fork code.
 */
async function main() {
  const org = await db.organization.upsert({
    where: { slug: "dcica" },
    update: {},
    create: {
      slug: "dcica",
      name: "dcica",
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

  // ── Sample camp ──
  const event = await db.event.upsert({
    where: { orgId_code: { orgId: org.id, code: "MC-2026W" } },
    update: {},
    create: {
      orgId: org.id,
      type: "CAMP",
      status: "OPEN",
      code: "MC-2026W",
      name: "Winter Medical Camp 2026",
      startsAt: new Date("2026-12-05T08:00:00Z"),
      endsAt: new Date("2026-12-05T14:00:00Z"),
      venueConfig: { layout: "clinic", rooms: 7, tents: 2 },
    },
  });

  // ── Capacity caps (enforced at DB on the payment webhook) ──
  const allServices = await db.serviceType.findMany({ where: { orgId: org.id } });
  for (const s of allServices) {
    await db.serviceCap.upsert({
      where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: s.id } },
      update: {},
      create: { eventId: event.id, serviceTypeId: s.id, capacity: 200 },
    });
  }

  // ── Default Care Spine stations ──
  const stations = [
    { key: "checkin", name: "Check-In", sequence: 0 },
    { key: "vitals", name: "Vitals", sequence: 1 },
    { key: "consult", name: "Doctor Consult", sequence: 2 },
    { key: "labs", name: "Labs / Imaging", sequence: 3 },
  ];
  for (const st of stations) {
    await db.station.upsert({
      where: { eventId_key: { eventId: event.id, key: st.key } },
      update: {},
      create: { orgId: org.id, eventId: event.id, ...st },
    });
  }

  console.log(`Seeded org ${org.slug} with camp ${event.code}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
