import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed always targets this
// project's .env DB, not a global var from another project on the machine.
config({ override: true });

import { PrismaClient } from "@prisma/client";
import { autoStationColor } from "../src/lib/stationColors";

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
      update: { colorHex: autoStationColor(st.key, st.sequence) },
      create: {
        orgId: org.id,
        eventId: event.id,
        ...st,
        colorHex: autoStationColor(st.key, st.sequence),
      },
    });
  }

  // ── Default volunteer roles (config-over-code; per-event) ──
  const volunteerRoles = [
    { key: "registration", name: "Registration desk support", minAge: 16, capacity: 8, shift: "8:00–12:00", description: "Help registrants check in." },
    { key: "greeter", name: "Greeter / wayfinding", minAge: 0, capacity: 6, shift: "7:30–11:30", description: "Welcome and direct people." },
    { key: "runner", name: "Runner", minAge: 0, capacity: 5, shift: "8:00–14:00", description: "Move supplies between stations." },
    { key: "translator", name: "Translator", minAge: 18, capacity: 4, shift: "9:00–13:00", description: "Interpret for patients.", requiresClearance: true },
    { key: "setup", name: "Setup / teardown", minAge: 16, capacity: 10, shift: "6:30–8:30", description: "Set up and break down the venue." },
  ];
  for (const r of volunteerRoles) {
    await db.volunteerRole.upsert({
      where: { eventId_key: { eventId: event.id, key: r.key } },
      update: {},
      create: {
        orgId: org.id,
        eventId: event.id,
        key: r.key,
        name: r.name,
        description: r.description,
        minAge: r.minAge,
        capacity: r.capacity,
        shift: r.shift,
        instructions: `Report to the ${r.name} lead at check-in. Comfortable shoes recommended.`,
        requiresClearance: Boolean(r.requiresClearance),
      },
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
