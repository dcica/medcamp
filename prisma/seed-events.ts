import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so this targets the project's .env
// DB (the local Docker Postgres), not a global var from another project.
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Replaces the test/sample events with dcica's real public event lineup
 * (sourced from https://dcica.org/dcica-events/) plus the town's 4th of July.
 *
 * Per-event public actions are config (offersRegistration / offersVendors /
 * offersVolunteers): the medical camp takes registrations and volunteers; the
 * 4th of July is a town event we only attend, so volunteer signup only; the
 * Independence Day community event takes vendors and volunteers.
 *
 * NOTE: dcica.org lists these as annual events with mostly past dates. Dates
 * here are rolled to each event's next occurrence relative to mid-2026 so the
 * "Upcoming events" page is meaningful. Times are placeholders — adjust freely.
 */

type Seed = {
  code: string;
  type: "CAMP" | "GENERAL";
  name: string;
  startsAt: string;
  endsAt: string;
  imageUrl: string | null;
  offersRegistration: boolean;
  offersVendors: boolean;
  offersVolunteers: boolean;
};

const EVENTS: Seed[] = [
  {
    code: "JUL4-2026",
    type: "GENERAL",
    name: "4th of July",
    startsAt: "2026-07-04T14:00:00Z",
    endsAt: "2026-07-04T18:00:00Z",
    imageUrl: null,
    // Town's event — we attend, so volunteers only.
    offersRegistration: false,
    offersVendors: false,
    offersVolunteers: true,
  },
  {
    code: "IND-2026",
    type: "GENERAL",
    name: "India Independence Day",
    startsAt: "2026-08-15T15:00:00Z",
    endsAt: "2026-08-15T19:00:00Z",
    imageUrl: "/events/independence-day.png",
    // Community event — vendors + volunteers, no ticketing.
    offersRegistration: false,
    offersVendors: true,
    offersVolunteers: true,
  },
  {
    code: "DAN-2026",
    type: "GENERAL",
    name: "Dandiya",
    startsAt: "2026-09-27T23:00:00Z",
    endsAt: "2026-09-28T03:00:00Z",
    imageUrl: null,
    offersRegistration: true,
    offersVendors: true,
    offersVolunteers: true,
  },
  {
    code: "DIW-2026",
    type: "GENERAL",
    name: "Diwali Dhamaka",
    startsAt: "2026-11-01T22:00:00Z",
    endsAt: "2026-11-02T03:00:00Z",
    imageUrl: null,
    offersRegistration: true,
    offersVendors: true,
    offersVolunteers: true,
  },
  {
    code: "HOLI-2027",
    type: "GENERAL",
    name: "Holi",
    startsAt: "2027-03-21T16:00:00Z",
    endsAt: "2027-03-21T20:00:00Z",
    imageUrl: null,
    offersRegistration: true,
    offersVendors: true,
    offersVolunteers: true,
  },
  {
    code: "MC-2027",
    type: "CAMP",
    name: "Free Medical Camp",
    startsAt: "2027-06-06T13:00:00Z",
    endsAt: "2027-06-06T19:00:00Z",
    imageUrl: "/events/medical-camp.jpg",
    // The camp itself: registrations + volunteers (no vendor booths).
    offersRegistration: true,
    offersVendors: false,
    offersVolunteers: true,
  },
];

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

  // Clear the existing (test/sample) events; cascades their orders/attendees.
  const removed = await db.event.deleteMany({ where: { orgId: org.id } });
  console.log(`Removed ${removed.count} existing event(s).`);

  for (const e of EVENTS) {
    const event = await db.event.create({
      data: {
        orgId: org.id,
        type: e.type,
        status: "OPEN",
        code: e.code,
        name: e.name,
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
        imageUrl: e.imageUrl,
        offersRegistration: e.offersRegistration,
        offersVendors: e.offersVendors,
        offersVolunteers: e.offersVolunteers,
      },
    });

    // The camp needs capacity caps so the registration portal can show + cap
    // its service menu, mirroring the base seed.
    if (e.type === "CAMP") {
      const services = await db.serviceType.findMany({
        where: { orgId: org.id },
      });
      for (const s of services) {
        await db.serviceCap.create({
          data: { eventId: event.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity: 200 },
        });
      }
    }

    console.log(`+ ${e.name} (${e.code})`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
