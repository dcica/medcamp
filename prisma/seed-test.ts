import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed targets the env file's DB.
// ENV_FILE overrides which file is loaded (e.g. ENV_FILE=.env.test for the test DB).
config({ path: process.env.ENV_FILE ?? ".env", override: true });

import { PrismaClient, type Role } from "@prisma/client";
import { autoStationColor } from "../src/lib/stationColors";

const db = new PrismaClient();

/**
 * TEST DATA SET (separate from the base seed). Creates an ACTIVE camp wired so
 * every staff screen has something to show:
 *   - dashboard: queue depths (incl. a consult bottleneck), flow stats,
 *     payments by method, needs-payment add-ons
 *   - station queues: waiting / in-progress / done across the route
 *   - check-in: paid + waiver-signed and not-yet-checked-in attendees
 *   - lab tracking: pending / received / mailed
 *   - admin/members: one member per role (matching the /test-login accounts)
 *
 * Idempotent: drops and rebuilds the test camp (code MC-2027S) on each run.
 * Run with:  npm run db:seed:test
 */

const CAMP_CODE = "MC-2027S";

// Mirror of src/lib/testAccounts.ts (kept inline so the seed has no "@/" alias
// import — tsx runs this without tsconfig path resolution).
const TEST_MEMBERS: {
  email: string;
  name: string;
  role: Role;
  canHoldTill: boolean;
  canOverrideWaiver: boolean;
}[] = [
  { email: "coordinator@dcica.test", name: "Coordinator (superuser)", role: "COORDINATOR", canHoldTill: true, canOverrideWaiver: true },
  { email: "regdesk@dcica.test", name: "Registration desk — till", role: "REGISTRATION_TILL", canHoldTill: true, canOverrideWaiver: false },
  { email: "regdesk-notill@dcica.test", name: "Registration desk — no till", role: "REGISTRATION_NO_TILL", canHoldTill: false, canOverrideWaiver: false },
  { email: "volunteer@dcica.test", name: "Station volunteer", role: "STATION_VOLUNTEER", canHoldTill: false, canOverrideWaiver: false },
  { email: "doctor@dcica.test", name: "Doctor", role: "DOCTOR", canHoldTill: false, canOverrideWaiver: false },
  { email: "pos@dcica.test", name: "POS volunteer — till", role: "POS_TILL", canHoldTill: true, canOverrideWaiver: false },
  { email: "admin@dcica.test", name: "Committee / admin", role: "COMMITTEE_ADMIN", canHoldTill: false, canOverrideWaiver: false },
  { email: "volcoord@dcica.test", name: "Volunteer coordinator", role: "VOLUNTEER_COORDINATOR", canHoldTill: false, canOverrideWaiver: false },
];

const SERVICES = [
  { key: "vision", name: "Vision Screening", priceCents: 1500, colorHex: "#2563eb", hasLab: false },
  { key: "dental", name: "Dental Check", priceCents: 2000, colorHex: "#16a34a", hasLab: false },
  { key: "bloodwork", name: "Bloodwork", priceCents: 3500, colorHex: "#dc2626", hasLab: true },
  { key: "general", name: "General Consult", priceCents: 0, colorHex: "#7c3aed", hasLab: false },
];

const STATIONS = [
  { key: "checkin", name: "Check-In", sequence: 0 },
  { key: "vitals", name: "Vitals", sequence: 1 },
  { key: "consult", name: "Doctor Consult", sequence: 2 },
  { key: "vision", name: "Vision", sequence: 3 },
  { key: "dental", name: "Dental", sequence: 4 },
  { key: "labs", name: "Labs / Imaging", sequence: 5 },
];

type VisitStatus = "QUEUED" | "IN_PROGRESS" | "DONE";

const FIRST = ["Priya", "Aarav", "Sara", "Diego", "Mei", "Omar", "Lena", "Kofi", "Yuki", "Nadia", "Raj", "Ana", "Sam", "Iris", "Tariq", "Bea", "Jon", "Hana", "Leo", "Zoe", "Carmen", "Vik"];
const LAST = ["Sharma", "Khan", "Lopez", "Chen", "Okafor", "Patel", "Rossi", "Ahmed", "Nguyen", "Kim", "Silva", "Haddad", "Park", "Costa", "Mensah", "Ortiz", "Singh", "Cruz", "Ali", "Reyes", "Diaz", "Roy"];

async function main() {
  const org = await db.organization.upsert({
    where: { slug: "dcica" },
    update: {},
    create: { slug: "dcica", name: "dcica", settings: { brand: "#0d6e6e", locale: "en" } },
  });

  // ── Members (one per role; match /test-login usernames) ──
  for (const m of TEST_MEMBERS) {
    const user = await db.user.upsert({
      where: { email: m.email },
      update: { name: m.name },
      create: { email: m.email, name: m.name },
    });
    await db.membership.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: { role: m.role, canHoldTill: m.canHoldTill, canOverrideWaiver: m.canOverrideWaiver },
      create: { orgId: org.id, userId: user.id, role: m.role, canHoldTill: m.canHoldTill, canOverrideWaiver: m.canOverrideWaiver },
    });
  }

  // ── Service menu (org-level; upsert so this works standalone) ──
  for (const s of SERVICES) {
    await db.serviceType.upsert({
      where: { orgId_key: { orgId: org.id, key: s.key } },
      update: { name: s.name, priceCents: s.priceCents, colorHex: s.colorHex, hasLab: s.hasLab },
      create: { orgId: org.id, ...s },
    });
  }
  const services = await db.serviceType.findMany({ where: { orgId: org.id } });
  const svcByKey = new Map(services.map((s) => [s.key, s]));

  // ── Family membership (platform-level; NOT camp-scoped, NOT PHI) ──
  // Plans (catalogue) + a few member instances spanning current / expiring /
  // expired so the membership admin and the gate's membership-comp lookup have
  // realistic data. A current membership admits the family free at honoring events.
  const YEAR = 365 * 24 * 3600 * 1000;
  const now = Date.now();
  const MEMBERSHIP_PLANS = [
    { key: "family-1yr", name: "Family Membership — 1 Year", termYears: 1, priceCents: 5100, partySize: 5 },
    { key: "family-2yr", name: "Family Membership — 2 Year", termYears: 2, priceCents: 10100, partySize: 5 },
    { key: "family-5yr", name: "Family Membership — 5 Year", termYears: 5, priceCents: 25100, partySize: 5 },
  ];
  for (const p of MEMBERSHIP_PLANS) {
    await db.membershipPlan.upsert({
      where: { orgId_key: { orgId: org.id, key: p.key } },
      update: { name: p.name, termYears: p.termYears, priceCents: p.priceCents, partySize: p.partySize },
      create: { orgId: org.id, ...p },
    });
  }
  const plans = await db.membershipPlan.findMany({ where: { orgId: org.id } });
  const planByKey = new Map(plans.map((p) => [p.key, p]));

  // Member instances (idempotent by the @member.test domain).
  await db.member.deleteMany({ where: { orgId: org.id, email: { endsWith: "@member.test" } } });
  const MEMBERS = [
    { name: "The Kapoor Family", email: "kapoor@member.test", plan: "family-2yr", validTo: new Date(now + 1.5 * YEAR) }, // current
    { name: "The Mehta Family", email: "mehta@member.test", plan: "family-1yr", validTo: new Date(now + 0.2 * YEAR) }, // current, expiring soon
    { name: "The Shah Family", email: "shah@member.test", plan: "family-5yr", validTo: new Date(now + 4 * YEAR) }, // current
    { name: "The Rao Family", email: "rao@member.test", plan: "family-1yr", validTo: new Date(now - 0.1 * YEAR) }, // expired
  ];
  for (const m of MEMBERS) {
    const plan = planByKey.get(m.plan)!;
    await db.member.create({
      data: {
        orgId: org.id,
        name: m.name,
        email: m.email,
        planId: plan.id,
        partySize: plan.partySize,
        validFrom: new Date(m.validTo.getTime() - plan.termYears * YEAR),
        validTo: m.validTo,
      },
    });
  }

  // ── Rebuild the test camp idempotently ──
  const existing = await db.event.findFirst({ where: { orgId: org.id, code: CAMP_CODE } });
  if (existing) {
    // Ledger entries survive a payment/line-item delete (FK SetNull), so clear the
    // ones this seed wrote (memo is prefixed with the event code) to stay idempotent.
    await db.ledgerEntry.deleteMany({ where: { orgId: org.id, memo: { startsWith: CAMP_CODE } } });
    // Payments survive an order delete (orderId SetNull), so clear them first.
    await db.payment.deleteMany({ where: { order: { eventId: existing.id } } });
    await db.event.delete({ where: { id: existing.id } }); // cascades the rest
  }

  // The staff screens resolve "the active camp" via findFirst({status:"ACTIVE"}),
  // which is nondeterministic with more than one. Demote any OTHER active camps so
  // this test camp is unambiguously the one shown on the dashboard/queues.
  const demoted = await db.event.updateMany({
    where: { orgId: org.id, status: "ACTIVE", code: { not: CAMP_CODE } },
    data: { status: "CLOSED" },
  });

  const camp = await db.event.create({
    data: {
      orgId: org.id,
      type: "CAMP",
      status: "ACTIVE",
      code: CAMP_CODE,
      name: "Test Camp — Active (Summer 2027)",
      startsAt: new Date("2027-06-05T08:00:00Z"),
      endsAt: new Date("2027-06-05T14:00:00Z"),
      venueConfig: { layout: "clinic", rooms: 7, tents: 2 },
      walkInOpensAt: new Date("2027-06-05T10:00:00Z"), // walk-in OPEN on dashboard
    },
  });

  // ── Stations + caps for this camp ──
  const stationByKey = new Map<string, { id: string }>();
  for (const st of STATIONS) {
    const row = await db.station.create({
      data: {
        orgId: org.id,
        eventId: camp.id,
        key: st.key,
        name: st.name,
        sequence: st.sequence,
        colorHex: autoStationColor(st.key, st.sequence),
      },
    });
    stationByKey.set(st.key, row);
  }
  for (const s of services) {
    await db.serviceCap.create({
      data: { eventId: camp.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity: 200 },
    });
  }

  // ── Attendee specs across every state the screens care about ──
  type Spec = {
    services: string[];
    method: "STRIPE" | "CASH";
    checkedIn: boolean;
    route: { key: string; status: VisitStatus }[];
    addon?: string; // serviceKey added on-site (PENDING_PAYMENT)
    lab?: "PENDING" | "RECEIVED" | "MAILED";
    donationCents?: number; // optional purchaser-entered donation (isDonation line)
  };

  const specs: Spec[] = [];

  // Consult bottleneck: 9 waiting at consult (>= 8 flags bottleneck)
  for (let i = 0; i < 9; i++) {
    specs.push({
      services: ["general", "vision"],
      method: i % 2 === 0 ? "STRIPE" : "CASH",
      checkedIn: true,
      route: [
        { key: "checkin", status: "DONE" },
        { key: "vitals", status: "DONE" },
        { key: "consult", status: "QUEUED" },
        { key: "vision", status: "QUEUED" },
      ],
    });
  }
  // 1 in progress at consult
  specs.push({
    services: ["general"],
    method: "STRIPE",
    checkedIn: true,
    route: [
      { key: "checkin", status: "DONE" },
      { key: "vitals", status: "DONE" },
      { key: "consult", status: "IN_PROGRESS" },
    ],
  });
  // 3 waiting at vitals
  for (let i = 0; i < 3; i++) {
    specs.push({
      services: ["general", "dental"],
      method: i % 2 === 0 ? "CASH" : "STRIPE",
      checkedIn: true,
      route: [
        { key: "checkin", status: "DONE" },
        { key: "vitals", status: "QUEUED" },
        { key: "consult", status: "QUEUED" },
        { key: "dental", status: "QUEUED" },
      ],
    });
  }
  // 1 in progress at vitals
  specs.push({
    services: ["general"],
    method: "CASH",
    checkedIn: true,
    route: [
      { key: "checkin", status: "DONE" },
      { key: "vitals", status: "IN_PROGRESS" },
      { key: "consult", status: "QUEUED" },
    ],
  });
  // 3 completed (whole route done)
  for (let i = 0; i < 3; i++) {
    specs.push({
      services: ["general", "bloodwork"],
      method: "STRIPE",
      checkedIn: true,
      route: [
        { key: "checkin", status: "DONE" },
        { key: "vitals", status: "DONE" },
        { key: "consult", status: "DONE" },
        { key: "labs", status: "DONE" },
      ],
      lab: i === 0 ? "MAILED" : i === 1 ? "RECEIVED" : "PENDING",
    });
  }
  // 2 needs-payment (doctor add-on at consult)
  for (let i = 0; i < 2; i++) {
    specs.push({
      services: ["general"],
      method: i % 2 === 0 ? "STRIPE" : "CASH",
      checkedIn: true,
      addon: "bloodwork",
      route: [
        { key: "checkin", status: "DONE" },
        { key: "vitals", status: "DONE" },
        { key: "consult", status: "IN_PROGRESS" },
        { key: "labs", status: "QUEUED" },
      ],
    });
  }
  // 3 registered but NOT checked in (paid; waiting to arrive)
  for (let i = 0; i < 3; i++) {
    specs.push({
      services: ["general", "vision"],
      method: i % 2 === 0 ? "STRIPE" : "CASH",
      checkedIn: false,
      route: [
        { key: "checkin", status: "QUEUED" },
        { key: "vitals", status: "QUEUED" },
        { key: "consult", status: "QUEUED" },
        { key: "vision", status: "QUEUED" },
      ],
    });
  }

  // A couple of registrants add an optional donation at checkout (acceptsDonations).
  specs[0].donationCents = 2500;
  specs[10].donationCents = 1000;

  // ── Materialize the specs ──
  let seq = 1;
  const baseTime = camp.startsAt.getTime();
  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx];
    const name = `${FIRST[idx % FIRST.length]} ${LAST[idx % LAST.length]}`;
    const campId = `${CAMP_CODE}-${String(seq).padStart(4, "0")}`;
    seq++;

    const paidServices = spec.services.map((k) => svcByKey.get(k)!).filter(Boolean);
    const serviceCents = paidServices.reduce((s, x) => s + x.priceCents, 0);
    const donationCents = spec.donationCents ?? 0;
    const paidCents = serviceCents + donationCents;
    const checkInAt = spec.checkedIn ? new Date(baseTime + idx * 60_000) : null;

    const order = await db.order.create({
      data: {
        orgId: org.id,
        eventId: camp.id,
        status: "CONFIRMED",
        registrantName: name,
        registrantEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        registrantPhone: "(555) 010-" + String(1000 + idx).slice(-4),
        marketingConsent: idx % 3 === 0,
        marketingConsentAt: idx % 3 === 0 ? new Date(baseTime) : null,
        method: spec.method,
      },
    });

    // Payment (SUCCEEDED) — paid total for the order, by method.
    const payment = await db.payment.create({
      data: {
        orgId: org.id,
        orderId: order.id,
        method: spec.method,
        status: "SUCCEEDED",
        amountCents: paidCents,
        stripePaymentIntentId: spec.method === "STRIPE" ? `pi_test_${order.id}` : null,
        cashTenderedCents: spec.method === "CASH" ? paidCents : null,
        cashChangeCents: spec.method === "CASH" ? 0 : null,
      },
    });
    // Ledger CREDIT (reconciliation reads ledger_entries; the live PaymentService
    // writes these, so the seed mirrors it). Memo prefixed with the code for cleanup.
    await db.ledgerEntry.create({
      data: {
        orgId: org.id,
        paymentId: payment.id,
        direction: "CREDIT",
        method: spec.method,
        amountCents: paidCents,
        memo: `${CAMP_CODE} ${name}`,
      },
    });

    const attendee = await db.attendee.create({
      data: {
        orgId: org.id,
        eventId: camp.id,
        orderId: order.id,
        campId,
        name,
        mailingAddress: `${100 + idx} Test St, Edison, NJ 08820`,
        waiverSigned: true,
        waiverSignedAt: new Date(baseTime),
        checkedInAt: checkInAt,
      },
    });

    // Paid line items.
    for (const svc of paidServices) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          serviceTypeId: svc.id,
          description: `${svc.name} — ${name}`,
          amountCents: svc.priceCents,
          status: "PAID",
        },
      });
    }

    // Optional donation (variable amount, no serviceType, flagged isDonation so
    // reconciliation breaks donations out from service revenue).
    if (donationCents > 0) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          description: `Donation — ${name}`,
          amountCents: donationCents,
          isDonation: true,
          status: "PAID",
        },
      });
    }

    // On-site add-on (needs payment).
    if (spec.addon) {
      const svc = svcByKey.get(spec.addon)!;
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          serviceTypeId: svc.id,
          description: `${svc.name} — ${name} (added on-site)`,
          amountCents: svc.priceCents,
          status: "PENDING_PAYMENT",
          addedOnsite: true,
        },
      });
    }

    // Station visits (the stored route).
    for (let r = 0; r < spec.route.length; r++) {
      const step = spec.route[r];
      const station = stationByKey.get(step.key)!;
      await db.stationVisit.create({
        data: {
          attendeeId: attendee.id,
          stationId: station.id,
          sequence: r,
          status: step.status,
          enteredAt: step.status !== "QUEUED" ? new Date(baseTime + idx * 60_000) : null,
          doneAt: step.status === "DONE" ? new Date(baseTime + idx * 60_000 + 300_000) : null,
        },
      });
    }

    // Lab status (logistics only — no results).
    if (spec.lab && spec.services.includes("bloodwork")) {
      await db.labStatus.create({
        data: {
          attendeeId: attendee.id,
          serviceKey: "bloodwork",
          state: spec.lab,
          receivedAt: spec.lab !== "PENDING" ? new Date(baseTime) : null,
          mailedAt: spec.lab === "MAILED" ? new Date(baseTime) : null,
        },
      });
    }
  }

  // Keep the campId sequence consistent for any future real registrations.
  await db.event.update({ where: { id: camp.id }, data: { nextCampSeq: seq } });

  // ── Volunteer flow (Module 9; platform-level, roles configured per event) ──
  // Seeds roles + signups across every state so the volunteer dashboard, roster,
  // counselor rollup, and certificates all render with realistic data. Volunteers
  // are staff, not patients — retained across events (no PHI purge).
  //
  // Idempotent: wipe prior test rows explicitly (roles/counselors aren't cleared
  // by the camp rebuild for past events, though this event's cascade covers them).
  await db.volunteer.deleteMany({
    where: { orgId: org.id, email: { endsWith: "@volunteer.test" } },
  }); // cascades their signups
  await db.volunteerRole.deleteMany({
    where: { orgId: org.id, key: { startsWith: "test-" } },
  }); // cascades any remaining signups
  await db.counselor.deleteMany({
    where: { orgId: org.id, email: { endsWith: "@school.test" } },
  });

  const VOL_ROLES = [
    { key: "test-reg", name: "Registration Helper", ageGroup: "16+", minAge: 16, capacity: 8, shift: "8:00–12:00" },
    { key: "test-greet", name: "Greeter / Wayfinding", ageGroup: "Any", minAge: 0, capacity: 6, shift: "7:30–11:30" },
    { key: "test-translate", name: "Translator", ageGroup: "18+", minAge: 18, capacity: 4, shift: "9:00–13:00", requiresClearance: true },
    { key: "test-setup", name: "Setup / Teardown", ageGroup: "16+", minAge: 16, capacity: 10, shift: "6:30–8:30" },
    { key: "test-runner", name: "Runner", ageGroup: "Any", minAge: 0, capacity: 5, shift: "8:00–14:00" },
  ];
  const roleByKey = new Map<string, { id: string }>();
  for (const r of VOL_ROLES) {
    const row = await db.volunteerRole.create({
      data: {
        orgId: org.id,
        eventId: camp.id,
        key: r.key,
        name: r.name,
        ageGroup: r.ageGroup,
        minAge: r.minAge,
        capacity: r.capacity,
        shift: r.shift,
        instructions: `Report to the ${r.name} lead at check-in. Wear comfortable shoes; water provided.`,
        requiresClearance: Boolean(r.requiresClearance),
      },
    });
    roleByKey.set(r.key, row);
  }

  // A handful of persistent school counselors (the recruitment asset).
  const COUNSELORS = [
    { name: "Ms. Patel", email: "patel@school.test", title: "NHS Advisor", school: "Edison High" },
    { name: "Mr. Nguyen", email: "nguyen@school.test", title: "Service-Learning Coordinator", school: "JP Stevens HS" },
    { name: "Dr. Cohen", email: "cohen@school.test", title: "Counselor", school: "Rutgers Prep" },
  ];
  const counselorByEmail = new Map<string, { id: string }>();
  for (const c of COUNSELORS) {
    const row = await db.counselor.create({ data: { orgId: org.id, ...c } });
    counselorByEmail.set(c.email, row);
  }

  type SignupStatus =
    | "SIGNED_UP"
    | "WAITLISTED"
    | "CONFIRMED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "NO_SHOW";
  type AgeBand = "UNDER_16" | "AGE_16_17" | "AGE_18_PLUS";

  // (roleKey, status, hours for CHECKED_OUT, age band, school+counselor, source)
  const volSpecs: {
    role: string;
    status: SignupStatus;
    hours?: number;
    ageBand: AgeBand;
    counselor?: string; // counselor email
    source?: string;
  }[] = [
    { role: "test-reg", status: "CHECKED_OUT", hours: 4.5, ageBand: "AGE_16_17", counselor: "patel@school.test", source: "school" },
    { role: "test-reg", status: "CHECKED_IN", ageBand: "AGE_16_17", counselor: "patel@school.test", source: "school" },
    { role: "test-reg", status: "CONFIRMED", ageBand: "AGE_18_PLUS", source: "past" },
    { role: "test-greet", status: "CHECKED_OUT", hours: 3, ageBand: "UNDER_16", counselor: "nguyen@school.test", source: "school" },
    { role: "test-greet", status: "CHECKED_IN", ageBand: "AGE_16_17", counselor: "nguyen@school.test", source: "school" },
    { role: "test-greet", status: "NO_SHOW", ageBand: "UNDER_16", counselor: "patel@school.test", source: "school" },
    { role: "test-translate", status: "CONFIRMED", ageBand: "AGE_18_PLUS", source: "social" },
    { role: "test-translate", status: "SIGNED_UP", ageBand: "AGE_18_PLUS", source: "org" },
    { role: "test-setup", status: "CHECKED_OUT", hours: 2.5, ageBand: "AGE_16_17", counselor: "cohen@school.test", source: "school" },
    { role: "test-setup", status: "CHECKED_OUT", hours: 5, ageBand: "AGE_18_PLUS", source: "past" },
    { role: "test-setup", status: "CHECKED_IN", ageBand: "AGE_16_17", counselor: "cohen@school.test", source: "school" },
    { role: "test-runner", status: "CONFIRMED", ageBand: "UNDER_16", counselor: "nguyen@school.test", source: "school" },
    { role: "test-runner", status: "SIGNED_UP", ageBand: "AGE_16_17", counselor: "patel@school.test", source: "school" },
    { role: "test-runner", status: "WAITLISTED", ageBand: "UNDER_16", counselor: "cohen@school.test", source: "social" },
  ];

  let volSeq = 1;
  for (let i = 0; i < volSpecs.length; i++) {
    const v = volSpecs[i];
    const name = `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i + 9) % LAST.length]}`;
    const counselor = v.counselor ? counselorByEmail.get(v.counselor) : null;
    const school = counselor
      ? COUNSELORS.find((c) => c.email === v.counselor)?.school ?? null
      : null;
    const minor = v.ageBand !== "AGE_18_PLUS";
    const volunteer = await db.volunteer.create({
      data: {
        orgId: org.id,
        name,
        email: `vol${i + 1}@volunteer.test`,
        phone: "(555) 020-" + String(1000 + i).slice(-4),
        ageBand: v.ageBand,
        school,
        emergencyName: "Parent " + LAST[(i + 9) % LAST.length],
        emergencyPhone: "(555) 030-" + String(1000 + i).slice(-4),
      },
    });
    const checkedInAt =
      v.status === "CHECKED_IN" || v.status === "CHECKED_OUT"
        ? new Date(baseTime + i * 60_000)
        : null;
    const checkedOutAt =
      v.status === "CHECKED_OUT" && v.hours
        ? new Date((checkedInAt?.getTime() ?? baseTime) + v.hours * 3_600_000)
        : null;
    await db.volunteerSignup.create({
      data: {
        volunteerId: volunteer.id,
        eventId: camp.id,
        roleId: roleByKey.get(v.role)!.id,
        counselorId: counselor?.id ?? null,
        code: `VOL-${CAMP_CODE}-${String(volSeq).padStart(4, "0")}`,
        status: v.status,
        sourceTag: v.source ?? null,
        guardianName: minor ? "Parent " + LAST[(i + 9) % LAST.length] : null,
        guardianSignedAt: minor ? new Date(baseTime) : null,
        checkedInAt,
        checkedOutAt,
        hoursServed: v.status === "CHECKED_OUT" ? (v.hours ?? null) : null,
        certificateIssuedAt: null,
      },
    });
    volSeq++;
  }
  await db.event.update({ where: { id: camp.id }, data: { nextVolSeq: volSeq } });

  // ── Dandia gate (GENERAL event) — exercises the event gate + new event features ─
  // A ticketed dance night in QUANTITY-ONLY mode (collectsAttendeeDetails=false):
  // admission + fulfillable merch sold by quantity, optional donation, a family-
  // membership comp at the gate (honorsMembership=true → $0, COMP, no Payment row),
  // a membership upsell purchase, and a refunded order (allowsRefunds=true). Each
  // money movement writes a Ledger entry. Resolved by the gate via
  // getActiveGeneralEvent; medcamp screens ignore it (getActiveCamp scopes to CAMP).
  const DANDIA_CODE = "GB-2026W";
  const DANDIA_SERVICES = [
    { key: "dandia-entry", name: "Dandia Entry", priceCents: 2500, colorHex: "#9333ea", fulfillable: false },
    { key: "dandiya-sticks", name: "Dandiya Sticks", priceCents: 1500, colorHex: "#f59e0b", fulfillable: true },
    { key: "event-tshirt", name: "Event T-Shirt", priceCents: 2000, colorHex: "#0ea5e9", fulfillable: true },
  ];
  for (const s of DANDIA_SERVICES) {
    await db.serviceType.upsert({
      where: { orgId_key: { orgId: org.id, key: s.key } },
      update: { name: s.name, priceCents: s.priceCents, colorHex: s.colorHex, fulfillable: s.fulfillable },
      create: { orgId: org.id, ...s },
    });
  }
  const dandiaSvc = new Map(
    (
      await db.serviceType.findMany({
        where: { orgId: org.id, key: { in: DANDIA_SERVICES.map((s) => s.key) } },
      })
    ).map((s) => [s.key, s]),
  );

  const existingDandia = await db.event.findFirst({ where: { orgId: org.id, code: DANDIA_CODE } });
  if (existingDandia) {
    await db.ledgerEntry.deleteMany({ where: { orgId: org.id, memo: { startsWith: DANDIA_CODE } } });
    await db.payment.deleteMany({ where: { order: { eventId: existingDandia.id } } });
    await db.event.delete({ where: { id: existingDandia.id } });
  }

  const dandia = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "ACTIVE",
      code: DANDIA_CODE,
      name: "Dandia Night 2026",
      startsAt: new Date("2026-10-10T19:00:00Z"),
      endsAt: new Date("2026-10-10T23:30:00Z"),
      // New event-config flags (admin toggles):
      collectsAttendeeDetails: false, // quantity-only checkout — anon tickets + merch
      honorsMembership: true, // a current family membership admits the party free
      acceptsDonations: true,
      allowsRefunds: true,
    },
  });
  for (const s of dandiaSvc.values()) {
    // confirmOrderPaid requires a cap row per sellable service; 1000 ≈ uncapped.
    await db.serviceCap.create({
      data: { eventId: dandia.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity: 1000 },
    });
  }

  // Each line carries a quantity (qty-mode); fulfillable merch can be picked up
  // (will-call). A spec may add a donation, buy a membership, be a membership comp,
  // or be refunded.
  type DLine = { key: string; qty: number; fulfilled?: boolean };
  type DandiaSpec = {
    name: string;
    lines: DLine[];
    donationCents?: number;
    membershipPlan?: string; // a family membership bought as a registration upsell
    method: "STRIPE" | "CASH" | "COMP";
    status: "CONFIRMED" | "PENDING" | "REFUNDED";
    admitted: boolean;
    comp?: boolean; // membership comp admission ($0, COMP, no Payment row)
  };
  const dandiaSpecs: DandiaSpec[] = [
    // Stripe ticket, not yet admitted.
    { name: "Asha Mehta", lines: [{ key: "dandia-entry", qty: 1 }], method: "STRIPE", status: "CONFIRMED", admitted: false },
    // Ticket ×2 + 5 dandiya sticks (quantity line); sticks already picked up.
    { name: "Ravi Kapoor", lines: [{ key: "dandia-entry", qty: 2 }, { key: "dandiya-sticks", qty: 5, fulfilled: true }], method: "STRIPE", status: "CONFIRMED", admitted: true },
    // Cash ticket + 2 t-shirts, admitted, shirts NOT yet handed over (will-call pending).
    { name: "Neha Shah", lines: [{ key: "dandia-entry", qty: 1 }, { key: "event-tshirt", qty: 2 }], method: "CASH", status: "CONFIRMED", admitted: true },
    // Unpaid will-call (created, awaiting payment at the desk).
    { name: "Imran Vora", lines: [{ key: "dandia-entry", qty: 1 }], method: "STRIPE", status: "PENDING", admitted: false },
    // Membership comp: a current member's family admitted free ($0, COMP, no Payment).
    { name: "The Kapoor Family", lines: [{ key: "dandia-entry", qty: 4 }], method: "COMP", status: "CONFIRMED", admitted: true, comp: true },
    // Stripe ticket ×2 + an optional donation.
    { name: "Sara Ali", lines: [{ key: "dandia-entry", qty: 2 }], donationCents: 5000, method: "STRIPE", status: "CONFIRMED", admitted: false },
    // Registration upsell: buys a 2-year family membership alongside a ticket.
    { name: "Diego Lopez", lines: [{ key: "dandia-entry", qty: 2 }], membershipPlan: "family-2yr", method: "STRIPE", status: "CONFIRMED", admitted: false },
    // Refunded order: payment REFUNDED, lines REFUNDED, DEBIT ledger entry.
    { name: "Mei Chen", lines: [{ key: "dandia-entry", qty: 3 }], method: "STRIPE", status: "REFUNDED", admitted: false },
  ];

  let dseq = 1;
  const dandiaNow = new Date("2026-10-10T19:15:00Z");
  for (const spec of dandiaSpecs) {
    const campId = `${DANDIA_CODE}-${String(dseq).padStart(4, "0")}`;
    dseq++;

    const email = `${spec.name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const lineRows = spec.lines.map((l) => ({ svc: dandiaSvc.get(l.key)!, qty: l.qty, fulfilled: l.fulfilled }));
    const isComp = Boolean(spec.comp);
    const serviceCents = lineRows.reduce((s, l) => s + l.svc.priceCents * l.qty, 0);
    const donationCents = spec.donationCents ?? 0;
    const membership = spec.membershipPlan ? planByKey.get(spec.membershipPlan)! : null;
    const membershipCents = membership?.priceCents ?? 0;
    const total = isComp ? 0 : serviceCents + donationCents + membershipCents;

    const order = await db.order.create({
      data: {
        orgId: org.id,
        eventId: dandia.id,
        status: spec.status,
        method: spec.method,
        registrantName: spec.name,
        registrantEmail: email,
        registrantPhone: "(555) 030-0000",
      },
    });

    // Payment + ledger. COMP and unpaid (PENDING) orders move no money → no Payment.
    if (!isComp && spec.status !== "PENDING") {
      const refunded = spec.status === "REFUNDED";
      const method = spec.method as "STRIPE" | "CASH";
      const payment = await db.payment.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          method,
          status: refunded ? "REFUNDED" : "SUCCEEDED",
          amountCents: total,
          stripePaymentIntentId: method === "STRIPE" ? `pi_dandia_${order.id}` : null,
          cashTenderedCents: method === "CASH" ? total : null,
          cashChangeCents: method === "CASH" ? 0 : null,
        },
      });
      await db.ledgerEntry.create({
        data: { orgId: org.id, paymentId: payment.id, direction: "CREDIT", method, amountCents: total, memo: `${DANDIA_CODE} ${spec.name}` },
      });
      if (refunded) {
        await db.ledgerEntry.create({
          data: { orgId: org.id, paymentId: payment.id, direction: "DEBIT", method, amountCents: total, memo: `${DANDIA_CODE} ${spec.name} — refund` },
        });
      }
    }

    const attendee = await db.attendee.create({
      data: {
        orgId: org.id,
        eventId: dandia.id,
        orderId: order.id,
        campId,
        // Quantity-only event: a light label, no mailing address collected.
        name: spec.name,
        checkedInAt: spec.admitted ? dandiaNow : null,
      },
    });

    const lineStatus =
      spec.status === "REFUNDED" ? "REFUNDED" : spec.status === "PENDING" ? "PENDING_PAYMENT" : "PAID";

    // Admission / merch lines (quantity-aware). A comp admission is $0.
    for (const l of lineRows) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          serviceTypeId: l.svc.id,
          description: `${l.svc.name}${l.qty > 1 ? ` ×${l.qty}` : ""} — ${spec.name}`,
          amountCents: isComp ? 0 : l.svc.priceCents,
          quantity: l.qty,
          status: lineStatus,
          // Will-call hand-over: only meaningful for fulfillable merch.
          fulfilledAt: l.svc.fulfillable && l.fulfilled ? dandiaNow : null,
        },
      });
    }

    // Optional donation line (variable amount, no serviceType, flagged isDonation).
    if (donationCents > 0) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          description: `Donation — ${spec.name}`,
          amountCents: donationCents,
          isDonation: true,
          status: lineStatus,
        },
      });
    }

    // Membership bought as a registration upsell (links the plan) + the Member it creates.
    if (membership) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          membershipPlanId: membership.id,
          description: `${membership.name} — ${spec.name}`,
          amountCents: membership.priceCents,
          status: lineStatus,
        },
      });
      await db.member.upsert({
        where: { orgId_email: { orgId: org.id, email } },
        update: {},
        create: {
          orgId: org.id,
          name: spec.name,
          email,
          planId: membership.id,
          partySize: membership.partySize,
          validFrom: dandiaNow,
          validTo: new Date(dandiaNow.getTime() + membership.termYears * YEAR),
        },
      });
    }
  }
  await db.event.update({ where: { id: dandia.id }, data: { nextCampSeq: dseq } });

  const volByStatus = volSpecs.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});

  const checkedIn = specs.filter((s) => s.checkedIn).length;
  console.log(
    [
      `Seeded TEST data into org ${org.slug}:`,
      `  camp ${camp.code} (${camp.status}) — "${camp.name}"`,
      `  ${TEST_MEMBERS.length} members (one per role)`,
      `  ${specs.length} attendees (${checkedIn} checked in, ${specs.length - checkedIn} awaiting arrival)`,
      `  consult bottleneck + vitals queue + 3 completed + 2 needs-payment + 2 donations`,
      `  payments: STRIPE + CASH, each with a CREDIT ledger entry; labs: pending/received/mailed`,
      `  ${MEMBERSHIP_PLANS.length} membership plans, ${MEMBERS.length} family members (current/expiring/expired)`,
      `  ${VOL_ROLES.length} volunteer roles, ${volSpecs.length} signups ` +
        `(${Object.entries(volByStatus).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")})`,
      demoted.count > 0
        ? `  (demoted ${demoted.count} other ACTIVE camp(s) to CLOSED so this one is the active camp)`
        : ``,
      `  gate event ${dandia.code} (${dandia.status}) — "${dandia.name}" [quantity-only, honors membership]`,
      `    ${dandiaSpecs.length} order(s): qty merch, donation, membership upsell, membership COMP, refund, will-call`,
      `    gate IDs: ${DANDIA_CODE}-0001 … ${DANDIA_CODE}-${String(dseq - 1).padStart(4, "0")}  → open /gate`,
      ``,
      `  Enable test login:  TEST_LOGIN_ENABLED=true in .env, then visit /test-login`,
      `  Sample camp IDs:    ${CAMP_CODE}-0001 … ${CAMP_CODE}-${String(seq - 1).padStart(4, "0")}`,
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
