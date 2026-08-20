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
 * "Upcoming events" page is meaningful. Times are placeholders — adjust freely,
 * EXCEPT where an entry's own comment says otherwise. GARBA-2026 and RON-2026
 * carry times taken off a printed flyer: do not adjust those. Neither name,
 * date, time nor location is editable through the admin UI (updateCamp is
 * orphaned), so changing one here is a code change and a deploy, and the paper
 * in someone's hand does not get redeployed.
 *
 * All times in this file are UTC instants. Convert from venue wall-clock, and
 * check the DST offset for that specific date — America/Chicago is CDT (UTC-5)
 * from the second Sunday in March to the first Sunday in November, CST (UTC-6)
 * the rest of the year. One offset applied to a summer and a winter event is
 * how two camps ended up seeded at 2:00 AM and 3:00 AM.
 *
 * A SEED BOOTSTRAPS; IT DOES NOT SYNC. Every field below can also be edited by
 * a coordinator through the admin UI (updateCamp for name/dates/location,
 * setEventFlags for the collectsAttendeeDetails/honorsMembership/
 * acceptsDonations/allowsRefunds flags, saveServiceRow for ServiceType name/
 * colorHex/admits/fulfillable and ServiceCap priceCents/onsitePriceCents/
 * earlyBirdPriceCents/earlyBirdUntil/capacity). On CREATE this seed sets the
 * full definition. On an existing row it changes NOTHING by default — a
 * routine re-run (e.g. redeploying the test environment) must not silently
 * revert whatever a coordinator just configured. Set SEED_FORCE_UPDATE=1 to
 * opt back into full overwrite for a developer who genuinely wants seed
 * values reasserted (e.g. resetting a scratch database) — except
 * Event.status, which is create-only in every mode: see the comment on the
 * event upsert below for why.
 */
const FORCE_UPDATE = process.env.SEED_FORCE_UPDATE === "1";

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

const EVENTS: Seed[] = [
  {
    // Real Sept 19 afternoon, from the printed flyer — a live ticketed sale,
    // not a fixture. Flyer says 3:00–5:30 PM local at a Flower Mound TX venue.
    // Sept 19 2026 sits inside US daylight saving (2026: Mar 8 → Nov 1), so
    // America/Chicago is CDT = UTC-5: 3:00 PM → 20:00Z, 5:30 PM → 22:30Z.
    code: "GARBA-2026",
    type: "GENERAL",
    name: "DCICA-Shakti Garba Dance Class",
    // Sept 19 2026 is inside US DST, so CDT = UTC-5: 3:00 PM -> 20:00Z,
    // 5:30 PM -> 22:30Z. Matches the flyer.
    startsAt: "2026-09-19T20:00:00Z",
    endsAt: "2026-09-19T22:30:00Z",
    imageUrl: "/events/Garba-DanceClasses_2026.jpeg",
    description:
      "Learn Garba from traditional experts — all levels welcome. Celebrate, dance, connect. $5 per person, and spots are limited.",
    // What these three flags say: this event takes REGISTRATIONS, has no
    // vendor booths, and advertises no volunteer call on the flyer — so no
    // volunteerRoles are set below either. They say nothing about the channel:
    // this class also sells at the door (onsitePriceCents below, reached once a
    // coordinator flips it ACTIVE), so do NOT read this as "online sales only"
    // and do not cite it to argue the cheaper door price is a mistake.
    offersRegistration: true,
    offersVendors: false,
    offersVolunteers: false,
    location:
      "Wellington Activities Center, 3520 Furlong Drive East, Flower Mound, TX 75022",
    // Sells at the door as well as online, so it stays OPEN until a
    // coordinator flips it on the day. status is create-only either way.
    status: "OPEN",
    collectsAttendeeDetails: false, // quantity-only checkout — one admission, no per-person profile
    // Deliberately NOT honouring the household membership comp, unlike
    // RON-2026. This is a $5-level cost-recovery class: comping a family
    // membership's party would hand FIVE free entries per household — every
    // plan carries partySize 5 (family-1yr/2yr/5yr), and compUnits is that
    // party size exactly, not an approximation. At the $5.50 online price that
    // is $27.50 comped against a $51 one-year plan, so the class would not
    // cover the hall. Members still get their
    // allowance at Navratri. Client decision — do not "fix" for consistency.
    honorsMembership: false,
    acceptsDonations: true,
    allowsRefunds: false,
    services: [
      {
        key: "garba-class-entry",
        name: "Class Entry",
        colorHex: "#db2777",
        // THE DOOR IS CHEAPER HERE, ON PURPOSE — this is not a transposition
        // typo, and it inverts the platform's usual convention (RON-2026 is
        // $15 online / $20 door). The flyer's entry fee is $5. The client
        // wants the card processing fee passed to the online buyer instead of
        // absorbed by the org: at the non-profit rate $5.50 online nets
        // ~$5.08. Cash at the door carries no processor fee, so it stays
        // exactly $5.00. resolvePrice needs no special case — the door reads
        // onsitePriceCents (500) and online reads priceCents (550).
        priceCents: 550,
        onsitePriceCents: 500,
        admits: true,
        fulfillable: false,
        // PROVISIONAL. The flyer says "LIMITED ENTRIES" but names no number;
        // the real hall capacity has to come from the organisers (Madhu Rana /
        // Abha Joshi). 40 is a placeholder so the cap exists and sells —
        // a coordinator can edit it in the admin UI before the class.
        capacity: 40,
      },
    ],
  },
  {
    // Real Oct 10 evening — the org's actual ticketed sale, not a fixture.
    // Doors 4:30 PM / competition 5:00 PM local (CDT, UTC-5): 21:30Z–04:00Z.
    code: "RON-2026",
    type: "GENERAL",
    name: "Rhythm of Navratri",
    // Oct 10 2026 is inside US DST (2026: Mar 8 -> Nov 1), so Flower Mound is
    // CDT = UTC-5. The flyer states two times and they are not the same thing:
    // the competition starts at 5:00 PM (22:00Z) and the registration desk
    // opens at 4:30 PM. startsAt is the EVENT, so it is 22:00Z — it previously
    // read 21:30Z, which put the desk time on the public card and advertised a
    // start half an hour before the real one. Ends 11:00 PM CDT = 04:00Z+1.
    startsAt: "2026-10-10T22:00:00Z",
    endsAt: "2026-10-11T04:00:00Z",
    imageUrl: "/events/RoN-2026.jpeg",
    description:
      "DCICA-Shakti presents a Navratri dance competition. Cash prizes: $150 first, $100 second, $50 third. Entry is $30 per group and the registration desk opens at 4:30 PM.",
    offersRegistration: true,
    offersVendors: true,
    offersVolunteers: true,
    location: "McKamy Middle School, Flower Mound, TX",
    volunteerRoles: COMMUNITY_VOL_ROLES,
    // Sells at the door too, so it stays OPEN (online sales) until a
    // coordinator flips it to ACTIVE on the night — not seeded ACTIVE.
    status: "OPEN",
    collectsAttendeeDetails: false, // quantity-only checkout — tickets + merch, no per-person profile
    // No membership comp here, unlike a floor-admission night. The comp works
    // by admitting a household's party free, and this event sells nothing a
    // person is admitted on — the only line is a per-group competition fee.
    // Leaving it true would comp a team's entry fee on one member's household
    // plan, which is not what the allowance is for.
    honorsMembership: false,
    acceptsDonations: true,
    allowsRefunds: false,
    // Prices below are a starting point for the committee, not a constant —
    // the admin UI (Task A2, ServicesManager/saveServiceRow) lets a
    // coordinator edit any of these before doors. That edit now sticks: this
    // seed only sets these values on first create, and leaves them alone on
    // every re-run (SEED_FORCE_UPDATE=1 to reassert them deliberately). No
    // early bird here: the columns exist for a coordinator to set later, but
    // that's a committee call this seed doesn't make.
    services: [
      {
        key: "competition-entry",
        name: "Competition Entry",
        colorHex: "#dc2626",
        // $30 per GROUP, not per dancer — the unit here is a troupe. Quantity
        // on the checkout line is a count of groups entering, so a five-person
        // team buys one. admits:false because the entry fee buys a slot in the
        // competition, not admission for spectators; there is no floor sale at
        // this event at all.
        priceCents: 3000,
        admits: false,
        fulfillable: false,
        // 40 groups. Provisional, like the class capacity — the flyer says
        // "limited spots" without a number, so a coordinator sets the real
        // figure in the admin UI once the venue confirms.
        capacity: 40,
      },
    ],
  },
  {
    code: "DIW-2026",
    type: "GENERAL",
    name: "DCICA Festival of Lights",
    // Oct 24 2026, "4PM Onwards", still inside US DST so Flower Mound is
    // CDT = UTC-5: 4:00 PM -> 21:00Z. This was seeded Nov 1 before the flyer
    // existed; the flyer is the authority.
    //
    // The poster gives no end time. 10:00 PM (03:00Z next day) is an ESTIMATE
    // that exists so the card can render a range and so the event sorts out of
    // "upcoming" on the right day — it is not off a flyer. A coordinator should
    // set the real one in the admin UI.
    startsAt: "2026-10-24T21:00:00Z",
    endsAt: "2026-10-25T03:00:00Z",
    imageUrl: "/events/Diwali_2026.jpeg",
    location: "Gerault Park, Flower Mound, TX",
    description:
      "Free entry and free parking. High-rise fireworks, live entertainment, food and vendor booths. Presented with the Town of Flower Mound and D-SAW.",
    // FREE ENTRY, in the flyer's own words — so this event sells nothing and
    // takes no registration. That is why no `services` are declared: the org
    // catalogue still holds floor-admission and dandiya-sticks from an earlier
    // plan to ticket this night, and attaching them here would put a paid door
    // on a free community festival. Vendors and volunteers are the two things
    // this event does take.
    offersRegistration: false,
    offersVendors: true,
    offersVolunteers: true,
    volunteerRoles: COMMUNITY_VOL_ROLES,
  },
];

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

  // Counts for the end-of-run summary — an operator must be able to tell
  // whether a run changed anything without querying the database. Scoped to
  // events + services (the two things logged with a per-row prefix below);
  // ServiceCap/VolunteerRole follow the identical create-only-by-default rule
  // but aren't individually logged, to keep a routine run's output short.
  let created = 0;
  let unchanged = 0;
  let updatedCount = 0;

  // 2026-08-17: a routine run of this script deleted every event in the org —
  // cascading orders, attendees, and volunteer roles — because it treated the
  // whole table as disposable "test/sample" data. It destroyed the QA fixtures
  // (GB-2026W, MC-2027S), a completed $185 Stripe test order with five admitted
  // attendees, and orphaned 58 payments (Payment.orderId is SetNull, not
  // cascade, so the payment rows survived with no order to explain them). This
  // seed does not own every event in the org — only the ones in EVENTS below —
  // so it must never delete anything. Upsert only, forever.
  for (const e of EVENTS) {
    const existingEvent = await db.event.findUnique({
      where: { orgId_code: { orgId: org.id, code: e.code } },
    });

    // Descriptive + config fields only — status is handled separately below
    // and must never appear in this object, in either mode.
    const eventFields = {
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
    };

    const event = await db.event.upsert({
      where: { orgId_code: { orgId: org.id, code: e.code } },
      // A coordinator drives status DRAFT → OPEN → ACTIVE → CLOSED from the
      // admin UI. If a re-seed reset it, the door could stop working mid-event
      // (see RON-2026 going ACTIVE on the night of Oct 10). status is set on
      // create only — an existing event keeps whatever the coordinator set,
      // in EVERY mode, including SEED_FORCE_UPDATE=1. Everything else is a
      // bootstrap default a coordinator may have since changed via updateCamp
      // / setEventFlags, so by default this update writes nothing at all.
      update: FORCE_UPDATE ? eventFields : {},
      create: {
        orgId: org.id,
        status: e.status ?? "OPEN",
        code: e.code,
        ...eventFields,
        // Defaults mirror the schema's own column defaults, so an event that
        // doesn't set these comes out exactly as it did before this field existed.
        // (Already folded into eventFields above via the same ?? fallbacks.)
      },
    });

    if (!existingEvent) {
      created++;
      console.log(`+ ${e.name} (${e.code})`);
    } else if (FORCE_UPDATE) {
      updatedCount++;
      console.log(`~ ${e.name} (${e.code})`);
    } else {
      unchanged++;
      console.log(`= ${e.name} (${e.code})`);
    }

    // Per-event volunteer roles (so the "Volunteer" CTA leads to a real form).
    // Upsert by (eventId, key) so a re-seed updates the template in place
    // instead of duplicating rows. Bootstrap-only by default like everything
    // else — a coordinator may have retitled a role or resized its capacity.
    for (const r of e.volunteerRoles ?? []) {
      await db.volunteerRole.upsert({
        where: { eventId_key: { eventId: event.id, key: r.key } },
        update: FORCE_UPDATE
          ? {
              name: r.name,
              ageGroup: r.ageGroup,
              minAge: r.minAge,
              capacity: r.capacity,
              shift: r.shift,
              description: r.description,
            }
          : {},
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
      const existingSvc = await db.serviceType.findUnique({
        where: { orgId_key: { orgId: org.id, key: s.key } },
      });

      // admits/fulfillable is a correctness invariant, not a coordinator
      // preference — the three kinds are admission (admits, !fulfillable),
      // merch (!admits, fulfillable), and fee (neither). A wrong pair either
      // hands a scannable door ticket to a merch purchase or admits someone
      // who only paid a fee. Warn loudly on mismatch instead of silently
      // keeping it (default) or silently overwriting it (force) — either one
      // could be hiding a live safety bug.
      if (
        existingSvc &&
        (existingSvc.admits !== s.admits || existingSvc.fulfillable !== s.fulfillable)
      ) {
        console.warn(
          `  ! WARNING: "${s.key}" admits/fulfillable mismatch — DB has ` +
            `(admits=${existingSvc.admits}, fulfillable=${existingSvc.fulfillable}), seed ` +
            `declares (admits=${s.admits}, fulfillable=${s.fulfillable}). ` +
            (FORCE_UPDATE
              ? `SEED_FORCE_UPDATE=1 is set — overwriting to the seed's declared pair.`
              : `NOT overwritten — SEED_FORCE_UPDATE=1 would correct it. Verify this isn't ` +
                `a live safety bug (scannable ticket on merch, or a free admission via a fee) ` +
                `before forcing.`),
        );
      }

      const svc = await db.serviceType.upsert({
        where: { orgId_key: { orgId: org.id, key: s.key } },
        update: FORCE_UPDATE
          ? {
              name: s.name,
              colorHex: s.colorHex,
              priceCents: s.priceCents,
              admits: s.admits,
              fulfillable: s.fulfillable,
            }
          : {},
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

      if (!existingSvc) {
        created++;
        console.log(`  + ${s.name} (${s.key})`);
      } else if (FORCE_UPDATE) {
        updatedCount++;
        console.log(`  ~ ${s.name} (${s.key})`);
      } else {
        unchanged++;
        console.log(`  = ${s.name} (${s.key})`);
      }

      // ServiceCap.sold is incremented atomically at payment confirmation, so
      // a re-seed must never write a capacity below what's already sold —
      // that would leave a cap that contradicts its own sales and corrupts
      // capacity checks. Read the existing row first and clamp. This clamp
      // applies even under SEED_FORCE_UPDATE=1 — force reasserts coordinator
      // config, it does not relicense selling past capacity.
      const existingCap = await db.serviceCap.findUnique({
        where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: svc.id } },
      });
      const capacity = existingCap ? Math.max(s.capacity, existingCap.sold) : s.capacity;

      await db.serviceCap.upsert({
        where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: svc.id } },
        update: FORCE_UPDATE
          ? {
              priceCents: s.priceCents,
              onsitePriceCents: s.onsitePriceCents ?? null,
              earlyBirdPriceCents: s.earlyBirdPriceCents ?? null,
              earlyBirdUntil: s.earlyBirdUntil ? new Date(s.earlyBirdUntil) : null,
              capacity,
            }
          : {},
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
    // const's own comment for why a blind findMany is unsafe now. Same
    // bootstrap-only rule and sold-clamp as the ticketed-service caps above —
    // a coordinator can reprice a camp service from the same admin screen.
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
          update: FORCE_UPDATE ? { priceCents: s.priceCents, capacity } : {},
          create: { eventId: event.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity },
        });
      }
    }
  }

  console.log(
    `\nSummary: ${created} created, ${unchanged} left alone, ${updatedCount} updated ` +
      `(SEED_FORCE_UPDATE=${FORCE_UPDATE ? "1" : "0"}).`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
