import { config } from "dotenv";
// Override any inherited shell DATABASE_URL so the seed targets this project's DB.
config({ override: true });

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

  // ── Rebuild the test camp idempotently ──
  const existing = await db.event.findFirst({ where: { orgId: org.id, code: CAMP_CODE } });
  if (existing) {
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
      data: { eventId: camp.id, serviceTypeId: s.id, capacity: 200 },
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

  // ── Materialize the specs ──
  let seq = 1;
  const baseTime = camp.startsAt.getTime();
  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx];
    const name = `${FIRST[idx % FIRST.length]} ${LAST[idx % LAST.length]}`;
    const campId = `${CAMP_CODE}-${String(seq).padStart(4, "0")}`;
    seq++;

    const paidServices = spec.services.map((k) => svcByKey.get(k)!).filter(Boolean);
    const paidCents = paidServices.reduce((s, x) => s + x.priceCents, 0);
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
    await db.payment.create({
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

  // ── Volunteer flow (platform-level; roles configured per event) ──
  // NOTE: no live volunteer screen in the app yet (Module 9). This seeds the
  // Volunteer / VolunteerRole / VolunteerSignup tables so the data is ready and
  // inspectable via `npm run db:studio` until that module ships.
  //
  // Idempotent: VolunteerRole has no event FK (eventId is a soft field), so the
  // camp rebuild above doesn't clear it — wipe prior test rows explicitly.
  await db.volunteer.deleteMany({
    where: { orgId: org.id, email: { endsWith: "@volunteer.test" } },
  }); // cascades their signups
  await db.volunteerRole.deleteMany({
    where: { orgId: org.id, key: { startsWith: "test-" } },
  }); // cascades any remaining signups

  const VOL_ROLES = [
    { key: "test-reg", name: "Registration Helper", ageGroup: "16+", capacity: 8 },
    { key: "test-greet", name: "Greeter / Wayfinding", ageGroup: "13+", capacity: 6 },
    { key: "test-translate", name: "Translator", ageGroup: "18+", capacity: 4 },
    { key: "test-setup", name: "Setup / Teardown", ageGroup: "16+", capacity: 10 },
    { key: "test-runner", name: "Runner", ageGroup: "13+", capacity: 5 },
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
        capacity: r.capacity,
      },
    });
    roleByKey.set(r.key, row);
  }

  type SignupStatus =
    | "SIGNED_UP"
    | "CONFIRMED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "NO_SHOW";

  // (roleKey, status, shift hours for CHECKED_OUT)
  const volSpecs: { role: string; status: SignupStatus; hours?: number }[] = [
    { role: "test-reg", status: "CHECKED_OUT", hours: 4.5 },
    { role: "test-reg", status: "CHECKED_IN" },
    { role: "test-reg", status: "CONFIRMED" },
    { role: "test-greet", status: "CHECKED_OUT", hours: 3 },
    { role: "test-greet", status: "CHECKED_IN" },
    { role: "test-greet", status: "NO_SHOW" },
    { role: "test-translate", status: "CONFIRMED" },
    { role: "test-translate", status: "SIGNED_UP" },
    { role: "test-setup", status: "CHECKED_OUT", hours: 2.5 },
    { role: "test-setup", status: "CHECKED_OUT", hours: 5 },
    { role: "test-setup", status: "CHECKED_IN" },
    { role: "test-runner", status: "CONFIRMED" },
    { role: "test-runner", status: "SIGNED_UP" },
    { role: "test-runner", status: "NO_SHOW" },
  ];

  for (let i = 0; i < volSpecs.length; i++) {
    const v = volSpecs[i];
    const name = `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i + 9) % LAST.length]}`;
    const volunteer = await db.volunteer.create({
      data: {
        orgId: org.id,
        name,
        email: `vol${i + 1}@volunteer.test`,
        phone: "(555) 020-" + String(1000 + i).slice(-4),
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
        roleId: roleByKey.get(v.role)!.id,
        status: v.status,
        checkedInAt,
        checkedOutAt,
      },
    });
  }

  // ── Dandia gate (GENERAL event) — exercises the event gate ──────────────────
  // A ticketed dance night: admission + fulfillable merch (will-call pickup) and
  // pre-bought attendees across the gate states (paid, paid+merch, already
  // admitted, unpaid will-call). Resolved by the gate via getActiveGeneralEvent;
  // medcamp screens ignore it (getActiveCamp is scoped to type CAMP).
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
    },
  });
  for (const s of dandiaSvc.values()) {
    // confirmOrderPaid requires a cap row per sellable service; 1000 ≈ uncapped.
    await db.serviceCap.create({
      data: { eventId: dandia.id, serviceTypeId: s.id, capacity: 1000 },
    });
  }

  const dandiaSpecs: { name: string; services: string[]; paid: boolean; admitted: boolean }[] = [
    { name: "Asha Mehta", services: ["dandia-entry"], paid: true, admitted: false }, // tkt
    { name: "Ravi Kapoor", services: ["dandia-entry", "dandiya-sticks"], paid: true, admitted: false }, // tkt + merch
    { name: "Neha Shah", services: ["dandia-entry", "event-tshirt"], paid: true, admitted: true }, // already admitted
    { name: "Imran Vora", services: ["dandia-entry"], paid: false, admitted: false }, // unpaid will-call
  ];
  let dseq = 1;
  const dandiaNow = new Date("2026-10-10T19:15:00Z");
  for (const spec of dandiaSpecs) {
    const campId = `${DANDIA_CODE}-${String(dseq).padStart(4, "0")}`;
    dseq++;
    const items = spec.services.map((k) => dandiaSvc.get(k)!);
    const total = items.reduce((s, x) => s + x.priceCents, 0);

    const order = await db.order.create({
      data: {
        orgId: org.id,
        eventId: dandia.id,
        status: spec.paid ? "CONFIRMED" : "PENDING",
        method: "STRIPE",
        registrantName: spec.name,
        registrantEmail: `${spec.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        registrantPhone: "(555) 030-0000",
      },
    });
    if (spec.paid) {
      await db.payment.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          method: "STRIPE",
          status: "SUCCEEDED",
          amountCents: total,
          stripePaymentIntentId: `pi_dandia_${order.id}`,
        },
      });
    }
    const attendee = await db.attendee.create({
      data: {
        orgId: org.id,
        eventId: dandia.id,
        orderId: order.id,
        campId,
        name: spec.name,
        checkedInAt: spec.admitted ? dandiaNow : null,
      },
    });
    for (const it of items) {
      await db.lineItem.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          attendeeId: attendee.id,
          serviceTypeId: it.id,
          description: `${it.name} — ${spec.name}`,
          amountCents: it.priceCents,
          status: spec.paid ? "PAID" : "PENDING_PAYMENT",
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
      `  consult bottleneck + vitals queue + 3 completed + 2 needs-payment`,
      `  payments: STRIPE + CASH; labs: pending/received/mailed`,
      `  ${VOL_ROLES.length} volunteer roles, ${volSpecs.length} signups ` +
        `(${Object.entries(volByStatus).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")})`,
      demoted.count > 0
        ? `  (demoted ${demoted.count} other ACTIVE camp(s) to CLOSED so this one is the active camp)`
        : ``,
      `  gate event ${dandia.code} (${dandia.status}) — "${dandia.name}"`,
      `    ${dandiaSpecs.length} ticket(s): paid / paid+merch / already-admitted / unpaid will-call`,
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
