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
  location?: string;
  description?: string;
  externallyHosted?: boolean;
  hostedByName?: string;
  externalUrl?: string;
  // Event lifecycle + config flags. All optional, defaulting to today's
  // behaviour (OPEN, and the schema's own column defaults) so the five
  // pre-existing events come out of the seed unchanged.
  status?: "DRAFT" | "OPEN" | "ACTIVE";
  collectsAttendeeDetails?: boolean;
  honorsMembership?: boolean;
  acceptsDonations?: boolean;
  allowsRefunds?: boolean;
  // Ticketed-event service menu (admission / merch / fee). Absent for events
  // that don't sell anything at the door — see the three-kind table on
  // ServiceType (admits × fulfillable) before adding one of these.
  services?: {
    key: string;
    name: string;
    colorHex: string;
    priceCents: number;
    onsitePriceCents?: number;
    earlyBirdPriceCents?: number;
    earlyBirdUntil?: string;
    admits: boolean;
    fulfillable: boolean;
    capacity: number;
  }[];
  volunteerRoles?: {
    key: string;
    name: string;
    ageGroup: string;
    minAge: number;
    capacity: number;
    shift?: string;
    description?: string;
  }[];
};

// The base camp's clinical menu (prisma/seed.ts). CAMP events below mirror it
// by explicit key, not by grabbing every org ServiceType — the org catalogue
// now also holds ticketed-event services (see RON-2026), and a blind
// findMany would wrongly cap those onto every camp too.
const CAMP_SERVICE_KEYS = ["vision", "dental", "bloodwork", "general"];

// Reusable volunteer-role templates. `key` is unique per event, so the same
// template set can be shared across events without collision.
type RoleSeed = NonNullable<Seed["volunteerRoles"]>[number];

const COMMUNITY_VOL_ROLES: RoleSeed[] = [
  { key: "setup", name: "Setup / Teardown", ageGroup: "16+", minAge: 16, capacity: 8, description: "Help set up and pack down stage, seating, and signage." },
  { key: "reg-desk", name: "Registration / Ticket Desk", ageGroup: "16+", minAge: 16, capacity: 6, description: "Check in guests, scan tickets, and answer questions." },
  { key: "greeter", name: "Greeter / Usher", ageGroup: "Any", minAge: 0, capacity: 6, description: "Welcome guests and help with seating and wayfinding." },
  { key: "food", name: "Food Stall Helper", ageGroup: "16+", minAge: 16, capacity: 8, description: "Serve food and drinks and keep the stall stocked and tidy." },
  { key: "cleanup", name: "Cleanup Crew", ageGroup: "Any", minAge: 0, capacity: 6, description: "Keep the venue tidy during the event and clear up afterward." },
];

const CAMP_VOL_ROLES: RoleSeed[] = [
  { key: "reg", name: "Registration Helper", ageGroup: "16+", minAge: 16, capacity: 8, description: "Help patients register and print badges at the front desk." },
  { key: "greet", name: "Greeter / Wayfinding", ageGroup: "Any", minAge: 0, capacity: 6, description: "Welcome patients and guide them between stations." },
  { key: "translate", name: "Translator", ageGroup: "18+", minAge: 18, capacity: 4, description: "Interpret for patients and clinical volunteers." },
  { key: "setup", name: "Setup / Teardown", ageGroup: "16+", minAge: 16, capacity: 10, description: "Set up and pack down stations, tents, and signage." },
  { key: "runner", name: "Runner", ageGroup: "Any", minAge: 0, capacity: 5, description: "Move supplies and messages between stations as needed." },
];

const EVENTS: Seed[] = [
  {
    code: "JUL4-2026",
    type: "GENERAL",
    name: "4th of July",
    startsAt: "2026-07-04T14:00:00Z",
    endsAt: "2026-07-04T18:00:00Z",
    imageUrl: null,
    // Not our event — dcica runs a community booth at the town's celebration, so
    // there is nothing to sell or register and no vendor play; volunteers only.
    offersRegistration: false,
    offersVendors: false,
    offersVolunteers: true,
    externallyHosted: true,
    hostedByName: "Town of Westborough",
    location: "Town Common, Main St, Westborough MA",
    description:
      "dcica is hosting a community booth at the town's 4th of July celebration. Come volunteer with us — greet visitors, hand out flyers, and help run kids' activities.",
    volunteerRoles: [
      { key: "booth-host", name: "Booth Host", ageGroup: "Any", minAge: 0, capacity: 6, shift: "2:00–6:00 PM", description: "Welcome visitors, share what dcica does, and hand out flyers." },
      { key: "booth-kids", name: "Kids' Activity Helper", ageGroup: "16+", minAge: 16, capacity: 4, shift: "2:00–6:00 PM", description: "Run face painting / crafts for kids at the booth." },
      { key: "booth-setup", name: "Setup / Teardown", ageGroup: "16+", minAge: 16, capacity: 4, shift: "1:00–2:30 & 5:30–7:00 PM", description: "Help put up and pack down the booth, tent, and signage." },
    ],
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
    volunteerRoles: COMMUNITY_VOL_ROLES,
  },
  {
    // Real Oct 10 evening — the org's actual ticketed sale, not a fixture.
    // Doors 4:30 PM / competition 5:00 PM local (CDT, UTC-5): 21:30Z–04:00Z.
    code: "RON-2026",
    type: "GENERAL",
    name: "Rhythm of Navratri",
    startsAt: "2026-10-10T21:30:00Z",
    endsAt: "2026-10-11T04:00:00Z",
    imageUrl: null,
    offersRegistration: true,
    offersVendors: true,
    offersVolunteers: true,
    location: "McKamy Middle School, Flower Mound, TX",
    volunteerRoles: COMMUNITY_VOL_ROLES,
    // Sells at the door too, so it stays OPEN (online sales) until a
    // coordinator flips it to ACTIVE on the night — not seeded ACTIVE.
    status: "OPEN",
    collectsAttendeeDetails: false, // quantity-only checkout — tickets + merch, no per-person profile
    honorsMembership: true, // a current family membership admits the party free
    acceptsDonations: true,
    allowsRefunds: false,
    // Prices are a starting point for the committee, not a constant — the
    // admin UI (Task A2) lets a coordinator edit any of these before doors.
    // No early bird here: the columns exist for a coordinator to set later,
    // but that's a committee call this seed doesn't make.
    services: [
      {
        key: "floor-admission",
        name: "Floor Admission",
        colorHex: "#9333ea",
        priceCents: 1500,
        onsitePriceCents: 2000,
        admits: true,
        fulfillable: false,
        capacity: 500,
      },
      {
        key: "dandiya-sticks",
        name: "Dandiya Sticks",
        colorHex: "#f59e0b",
        priceCents: 500,
        admits: false,
        fulfillable: true,
        capacity: 500,
      },
      {
        key: "competition-entry",
        name: "Competition Entry",
        colorHex: "#dc2626",
        priceCents: 3000,
        admits: false,
        fulfillable: false,
        capacity: 40,
      },
    ],
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
    volunteerRoles: COMMUNITY_VOL_ROLES,
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
    volunteerRoles: COMMUNITY_VOL_ROLES,
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
    volunteerRoles: CAMP_VOL_ROLES,
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

  // 2026-08-17: a routine run of this script deleted every event in the org —
  // cascading orders, attendees, and volunteer roles — because it treated the
  // whole table as disposable "test/sample" data. It destroyed the QA fixtures
  // (GB-2026W, MC-2027S), a completed $185 Stripe test order with five admitted
  // attendees, and orphaned 58 payments (Payment.orderId is SetNull, not
  // cascade, so the payment rows survived with no order to explain them). This
  // seed does not own every event in the org — only the ones in EVENTS below —
  // so it must never delete anything. Upsert only, forever.
  for (const e of EVENTS) {
    const event = await db.event.upsert({
      where: { orgId_code: { orgId: org.id, code: e.code } },
      // A coordinator drives status DRAFT → OPEN → ACTIVE → CLOSED from the
      // admin UI. If a re-seed reset it, the door could stop working mid-event
      // (see RON-2026 going ACTIVE on the night of Oct 10). status is set on
      // create only — an existing event keeps whatever the coordinator set.
      update: {
        type: e.type,
        name: e.name,
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
        imageUrl: e.imageUrl,
        offersRegistration: e.offersRegistration,
        offersVendors: e.offersVendors,
        offersVolunteers: e.offersVolunteers,
        location: e.location ?? null,
        description: e.description ?? null,
        externallyHosted: e.externallyHosted ?? false,
        hostedByName: e.hostedByName ?? null,
        externalUrl: e.externalUrl ?? null,
        collectsAttendeeDetails: e.collectsAttendeeDetails ?? true,
        honorsMembership: e.honorsMembership ?? false,
        acceptsDonations: e.acceptsDonations ?? true,
        allowsRefunds: e.allowsRefunds ?? false,
      },
      create: {
        orgId: org.id,
        type: e.type,
        status: e.status ?? "OPEN",
        code: e.code,
        name: e.name,
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
        imageUrl: e.imageUrl,
        offersRegistration: e.offersRegistration,
        offersVendors: e.offersVendors,
        offersVolunteers: e.offersVolunteers,
        location: e.location ?? null,
        description: e.description ?? null,
        externallyHosted: e.externallyHosted ?? false,
        hostedByName: e.hostedByName ?? null,
        externalUrl: e.externalUrl ?? null,
        // Defaults mirror the schema's own column defaults, so an event that
        // doesn't set these comes out exactly as it did before this field existed.
        collectsAttendeeDetails: e.collectsAttendeeDetails ?? true,
        honorsMembership: e.honorsMembership ?? false,
        acceptsDonations: e.acceptsDonations ?? true,
        allowsRefunds: e.allowsRefunds ?? false,
      },
    });

    // Per-event volunteer roles (so the "Volunteer" CTA leads to a real form).
    // Upsert by (eventId, key) so a re-seed updates the template in place
    // instead of duplicating rows.
    for (const r of e.volunteerRoles ?? []) {
      await db.volunteerRole.upsert({
        where: { eventId_key: { eventId: event.id, key: r.key } },
        update: {
          name: r.name,
          ageGroup: r.ageGroup,
          minAge: r.minAge,
          capacity: r.capacity,
          shift: r.shift,
          description: r.description,
        },
        create: {
          orgId: org.id,
          eventId: event.id,
          key: r.key,
          name: r.name,
          ageGroup: r.ageGroup,
          minAge: r.minAge,
          capacity: r.capacity,
          shift: r.shift,
          description: r.description,
        },
      });
    }

    // Explicit ticketed-service menu (RON-2026's admission/merch/fee ladder).
    // Upsert into the org catalogue by key so a re-seed doesn't duplicate rows,
    // then upsert this event's own cap. `admits` is set explicitly on every
    // entry — the column defaults to true, and leaving it off would make a
    // fee-kind service (competition-entry) both a fee AND a free admission.
    const seededServiceTypeIds: string[] = [];
    for (const s of e.services ?? []) {
      const svc = await db.serviceType.upsert({
        where: { orgId_key: { orgId: org.id, key: s.key } },
        update: {
          name: s.name,
          colorHex: s.colorHex,
          priceCents: s.priceCents,
          admits: s.admits,
          fulfillable: s.fulfillable,
        },
        create: {
          orgId: org.id,
          key: s.key,
          name: s.name,
          colorHex: s.colorHex,
          priceCents: s.priceCents,
          admits: s.admits,
          fulfillable: s.fulfillable,
        },
      });
      seededServiceTypeIds.push(svc.id);

      // ServiceCap.sold is incremented atomically at payment confirmation, so
      // a re-seed must never write a capacity below what's already sold —
      // that would leave a cap that contradicts its own sales and corrupts
      // capacity checks. Read the existing row first and clamp.
      const existingCap = await db.serviceCap.findUnique({
        where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: svc.id } },
      });
      const capacity = existingCap ? Math.max(s.capacity, existingCap.sold) : s.capacity;

      await db.serviceCap.upsert({
        where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: svc.id } },
        update: {
          priceCents: s.priceCents,
          onsitePriceCents: s.onsitePriceCents ?? null,
          earlyBirdPriceCents: s.earlyBirdPriceCents ?? null,
          earlyBirdUntil: s.earlyBirdUntil ? new Date(s.earlyBirdUntil) : null,
          capacity,
        },
        create: {
          eventId: event.id,
          serviceTypeId: svc.id,
          priceCents: s.priceCents,
          onsitePriceCents: s.onsitePriceCents ?? null,
          earlyBirdPriceCents: s.earlyBirdPriceCents ?? null,
          earlyBirdUntil: s.earlyBirdUntil ? new Date(s.earlyBirdUntil) : null,
          capacity,
        },
      });
    }

    // If a service was dropped from this event's seed list, its cap is stale.
    // History (and anything already sold) is not the seed's to discard, so we
    // only remove caps with sold = 0 — anything else is left in place and
    // logged for a human to look at.
    if (e.services) {
      const staleCaps = await db.serviceCap.findMany({
        where: { eventId: event.id, serviceTypeId: { notIn: seededServiceTypeIds } },
        include: { serviceType: true },
      });
      for (const cap of staleCaps) {
        if (cap.sold > 0) {
          console.log(
            `  ! kept stale cap for "${cap.serviceType.key}" on ${e.code} — sold=${cap.sold} > 0, not seed's to discard.`,
          );
        } else {
          await db.serviceCap.delete({ where: { id: cap.id } });
          console.log(`  - removed unsold stale cap for "${cap.serviceType.key}" on ${e.code}.`);
        }
      }
    }

    // The camp needs capacity caps so the registration portal can show + cap
    // its service menu, mirroring the base seed. Scoped to the base clinical
    // menu by key (CAMP_SERVICE_KEYS), not every org ServiceType — see the
    // const's own comment for why a blind findMany is unsafe now.
    if (e.type === "CAMP") {
      const services = await db.serviceType.findMany({
        where: { orgId: org.id, key: { in: CAMP_SERVICE_KEYS } },
      });
      for (const s of services) {
        const existingCap = await db.serviceCap.findUnique({
          where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: s.id } },
        });
        const capacity = existingCap ? Math.max(200, existingCap.sold) : 200;
        await db.serviceCap.upsert({
          where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: s.id } },
          update: { priceCents: s.priceCents, capacity },
          create: { eventId: event.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity },
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
