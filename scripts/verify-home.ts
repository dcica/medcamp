/**
 * Verifies the public front door: what an event card says it costs, how full it
 * is, when it happens, and which button it offers.
 *
 * WHY THIS SUITE EXISTS: the home page carried no price at all before this, and
 * three of the rules it now states had no coverage anywhere.
 *   - formatWhen had ZERO tests, and shipped a bug that dropped the door time
 *     from any evening crossing venue midnight (Dandiya Night, 7 PM-midnight).
 *   - eventActions lived module-private inside src/app/page.tsx, so the rule
 *     "an entry-fee event must NOT say Register" — the Festival of Lights
 *     outage — was unreachable from any script. It lives in src/lib now.
 *   - Nothing had ever asserted a price string a visitor reads.
 *
 * WHAT IT ASSERTS AGAINST: exported pure functions, one server read function,
 * and one structural rule read as text — never the component tree. Every row
 * here must survive EventPosterCard.tsx being rewritten from scratch.
 *
 *   npm run verify:home
 *   ENV_FILE=.env.test npm run verify:home
 *
 * Sections 1-5 are pure and need no database. Section 6 creates scratch events
 * and deletes them again.
 */

import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
// This must run BEFORE anything that touches src/lib/db — which is why every
// import of a module under test below is a dynamic `await import`, not a
// top-level one: a static import would construct Prisma against the stale var.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE_ADMIT = "VERIFY-HOME-A";
const CODE_FEE = "VERIFY-HOME-B";
const CODE_ELSEWHERE = "VERIFY-HOME-C";
const CODE_MERCH = "VERIFY-HOME-D";
const CODE_BARE = "VERIFY-HOME-E";
const CODE_MIXED = "VERIFY-HOME-F";
const ALL_CODES = [CODE_ADMIT, CODE_FEE, CODE_ELSEWHERE, CODE_MERCH, CODE_BARE, CODE_MIXED];

const ADMIT_KEY = "vh-admission";
const FEE_KEY = "vh-fee";
const MERCH_KEY = "vh-merch";
const FREE_KEY = "vh-free-service";
const ALL_KEYS = [ADMIT_KEY, FEE_KEY, MERCH_KEY, FREE_KEY];

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** A ServiceCap-shaped literal — resolvePrice takes a structural type. */
function cap(o: {
  price: number;
  door?: number | null;
  early?: number | null;
  until?: string | Date | null;
}) {
  return {
    priceCents: o.price,
    onsitePriceCents: o.door ?? null,
    earlyBirdPriceCents: o.early ?? null,
    earlyBirdUntil: o.until ? new Date(o.until) : null,
  };
}

async function main(): Promise<void> {
  const { formatWhen, formatVenueMonthDay, VENUE_TIME_ZONE } = await import(
    "../src/lib/eventTime"
  );
  const { priceLine, capacityLine } = await import("../src/lib/priceLine");
  const { resolvePrice } = await import("../src/lib/pricing");
  const { eventActions } = await import("../src/lib/eventActions");
  const { formatCentsCompact } = await import("../src/lib/money");

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§1  formatWhen — one evening, or a real date range");

  // Garba: 3:00-5:30 PM CDT, entirely inside one venue day. Unchanged.
  eq(
    "a same-day afternoon prints one date and both times",
    formatWhen(new Date("2026-09-19T20:00:00Z"), new Date("2026-09-19T22:30:00Z")),
    "Sep 19, 2026 · 3:00 PM – 5:30 PM",
  );

  // THE BUG. Dandiya Night runs 7:00 PM to midnight CDT. Midnight is the next
  // venue day, so this printed "Oct 10, 2026 – Oct 11, 2026" with no door time
  // at all — on a card whose entire job is to say when the floor opens.
  const dandiya = formatWhen(
    new Date("2026-10-11T00:00:00Z"),
    new Date("2026-10-11T05:00:00Z"),
  );
  eq(
    "an evening ending AT venue midnight is one evening, with its times",
    dandiya,
    "Oct 10, 2026 · 7:00 PM – 12:00 AM",
  );
  check("…and is not the bare date range it used to print", !dandiya.includes("Oct 11"), dandiya);

  // Rhythm of Navratri already landed inside one venue day (5-11 PM CDT) even
  // though it crosses UTC midnight. Regression guard for the earlier zone fix.
  eq(
    "a 5-11 PM event crossing UTC midnight was already one venue day",
    formatWhen(new Date("2026-10-10T22:00:00Z"), new Date("2026-10-11T04:00:00Z")),
    "Oct 10, 2026 · 5:00 PM – 11:00 PM",
  );

  // Boundary: 3:59 AM the next venue day is in, 5:00 AM is out.
  const spill359 = formatWhen(
    new Date("2026-10-11T00:00:00Z"),
    new Date("2026-10-11T08:59:00Z"),
  );
  check(
    "an end at 3:59 AM the next venue day is still one evening",
    spill359.startsWith("Oct 10, 2026 ·"),
    spill359,
  );
  eq(
    "an end at 5:00 AM the next venue day is NOT one evening",
    formatWhen(new Date("2026-10-11T00:00:00Z"), new Date("2026-10-11T10:00:00Z")),
    "Oct 10, 2026 – Oct 11, 2026",
  );

  // A genuine multi-day event must still read as a range, spill hour or not.
  eq(
    "a multi-day festival prints a date range",
    formatWhen(new Date("2026-07-01T15:00:00Z"), new Date("2026-07-04T03:00:00Z")),
    "Jul 1, 2026 – Jul 3, 2026",
  );

  // Festival of Lights: 4-10 PM CDT, crosses UTC midnight, one venue day.
  eq(
    "the Diwali festival's 4-10 PM window is one venue day",
    formatWhen(new Date("2026-10-24T21:00:00Z"), new Date("2026-10-25T03:00:00Z")),
    "Oct 24, 2026 · 4:00 PM – 10:00 PM",
  );

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§2  formatVenueMonthDay — the poster date pill");

  // 7 PM Oct 10 in Flower Mound is already Oct 11 in UTC. The pill and the
  // when-line sit two lines apart on one card and must agree.
  eq(
    "a 7 PM venue event pills as its VENUE day, not the UTC one",
    formatVenueMonthDay(new Date("2026-10-11T00:00:00Z")),
    "Oct 10",
  );
  const processZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (processZone === VENUE_TIME_ZONE) {
    console.log(
      `  ..    this box already runs ${VENUE_TIME_ZONE} — the zone-is-pinned row can't distinguish here`,
    );
  } else {
    check(
      "…and not the box's own zone",
      formatVenueMonthDay(new Date("2026-10-11T00:00:00Z")) !==
        new Date("2026-10-11T00:00:00Z").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      processZone,
    );
  }
  eq(
    "the pill carries no year and no time",
    formatVenueMonthDay(new Date("2026-09-19T20:00:00Z")),
    "Sep 19",
  );

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§3  priceLine — the phase a buyer actually faces");

  const before = new Date("2026-08-15T00:00:00Z");
  const after = new Date("2026-09-20T00:00:00Z");
  type Cap = Parameters<typeof resolvePrice>[0];
  const online = (c: Cap, now: Date) => resolvePrice(c, "online", now);

  // Dandiya's real ladder: $10 early bird, $12 online, $15 door.
  const dandiyaCap = cap({
    price: 1200,
    door: 1500,
    early: 1000,
    until: "2026-09-16T04:59:59Z",
  });
  eq(
    "early bird open: names the price, the last day, and what comes next",
    priceLine({ admission: online(dandiyaCap, before), fee: null, hasAnyOffering: true }),
    "$10 through Sep 15, then $12",
  );
  eq(
    "early bird closed: falls back to online and names the door",
    priceLine({ admission: online(dandiyaCap, after), fee: null, hasAnyOffering: true }),
    "$12 · $15 at the door",
  );

  // Garba: $5 in all three columns — the one row on the committee's pricing
  // sheet that does not vary. resolvePrice leaves nextAmountCents null when the
  // door is not strictly higher, so there must be no "at the door" clause.
  eq(
    "one price everywhere prints one price, with no door clause",
    priceLine({
      admission: online(cap({ price: 500, door: 500 }), before),
      fee: null,
      hasAnyOffering: true,
    }),
    "$5",
  );

  // The deadline is EXCLUSIVE in resolvePrice. Both spellings of "end of Aug 31"
  // must print Aug 31: the 23:59:59 one the seed uses, and a clean midnight.
  eq(
    "a 23:59:59 CDT deadline prints its own last valid day",
    priceLine({
      admission: online(cap({ price: 3000, early: 2500, until: "2026-09-01T04:59:59Z" }), before),
      fee: null,
      hasAnyOffering: true,
    }),
    "$25 through Aug 31, then $30",
  );
  eq(
    "a clean midnight-Sep-1 deadline prints Aug 31 too, not Sep 1",
    priceLine({
      admission: online(cap({ price: 3000, early: 2500, until: "2026-09-01T05:00:00Z" }), before),
      fee: null,
      hasAnyOffering: true,
    }),
    "$25 through Aug 31, then $30",
  );

  // A fee is per GROUP. Wording it per person is a $120 misunderstanding at the
  // desk for a five-person troupe.
  const ronFee = online(
    cap({ price: 3000, door: 3500, early: 2500, until: "2026-09-01T04:59:59Z" }),
    before,
  );
  const ronLine = priceLine({ admission: null, fee: ronFee, hasAnyOffering: true });
  eq(
    "a competition-only event: free to attend, priced per group to enter",
    ronLine,
    "Free entry · $25 a group through Aug 31, then $30",
  );
  check(
    "…and never says per person",
    !/per person|each|per dancer/i.test(ronLine ?? ""),
    ronLine ?? "",
  );

  eq(
    "a free festival with a flat competition fee",
    priceLine({
      admission: null,
      fee: online(cap({ price: 3000 }), before),
      hasAnyOffering: true,
    }),
    "Free entry · $30 a group",
  );
  eq(
    "a $0 admission reads as free entry",
    priceLine({
      admission: online(cap({ price: 0 }), before),
      fee: null,
      hasAnyOffering: true,
    }),
    "Free entry",
  );
  eq(
    "a $0 admission with a paid door still names the door",
    priceLine({
      admission: online(cap({ price: 0, door: 500 }), before),
      fee: null,
      hasAnyOffering: true,
    }),
    "Free · $5 at the door",
  );
  eq(
    "a $0 fee is omitted rather than printed as 'Free'",
    priceLine({
      admission: online(cap({ price: 1200 }), before),
      fee: online(cap({ price: 0 }), before),
      hasAnyOffering: true,
    }),
    "$12",
  );
  eq(
    "an event nobody has priced says nothing at all",
    priceLine({ admission: null, fee: null, hasAnyOffering: false }),
    null,
  );

  eq("whole dollars drop the cents", formatCentsCompact(2500), "$25");
  eq("real cents are kept", formatCentsCompact(550), "$5.50");

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§4  capacityLine — only when the number is news");

  eq(
    "uncapped prints nothing (uncapped is not zero)",
    capacityLine({ name: "Class Entry", capacity: null, sold: 0, kind: "ADMISSION" }),
    null,
  );
  eq(
    "a fresh 40-spot cap prints nothing — never '40 of 40 left'",
    capacityLine({ name: "Class Entry", capacity: 40, sold: 0, kind: "ADMISSION" }),
    null,
  );
  eq(
    "8 of 40 remaining is news",
    capacityLine({ name: "Class Entry", capacity: 40, sold: 32, kind: "ADMISSION" }),
    "8 spots left",
  );
  eq(
    "one left is singular",
    capacityLine({ name: "Class Entry", capacity: 40, sold: 39, kind: "ADMISSION" }),
    "1 spot left",
  );
  eq(
    "exhausted names the offering, not the event",
    capacityLine({ name: "Dandiya Entry", capacity: 500, sold: 500, kind: "ADMISSION" }),
    "Dandiya Entry is sold out",
  );
  eq(
    "oversold reads as sold out, never as a negative",
    capacityLine({ name: "Dandiya Entry", capacity: 25, sold: 33, kind: "ADMISSION" }),
    "Dandiya Entry is sold out",
  );
  eq(
    "a fee counts group slots",
    capacityLine({ name: "Competition Entry", capacity: 40, sold: 37, kind: "FEE" }),
    "3 group slots left",
  );
  eq(
    "one group slot is singular",
    capacityLine({ name: "Competition Entry", capacity: 40, sold: 39, kind: "FEE" }),
    "1 group slot left",
  );
  eq(
    "a large cap uses the fraction, not the flat ten",
    capacityLine({ name: "Dandiya Entry", capacity: 500, sold: 420, kind: "ADMISSION" }),
    "80 spots left",
  );

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§5  eventActions — one primary door, chosen by what is sold");

  const base = {
    id: "e1",
    type: "GENERAL",
    offersRegistration: true,
    offersVendors: false,
    offersVolunteers: false,
  };

  const feeOnly = eventActions(base, { hasFee: true, hasOther: false });
  eq("a fee-only event leads with the performance form", feeOnly[0]?.label, "Enter a performance");
  eq("…pointed at /perform, carrying its event", feeOnly[0]?.href, "/perform?event=e1");
  check(
    "…and NEVER offers Register — the wrong word and the wrong page",
    !feeOnly.some((a) => a.key === "register"),
    JSON.stringify(feeOnly.map((a) => a.key)),
  );

  const both = eventActions(base, { hasFee: true, hasOther: true });
  eq("an event selling both leads with the performance form", both[0]?.key, "perform");
  eq("…and still offers the sale door second", both[1]?.key, "register");

  eq(
    "an admission-only GENERAL event says Buy tickets",
    eventActions(base, { hasFee: false, hasOther: true })[0]?.label,
    "Buy tickets",
  );
  eq(
    "a CAMP says Register",
    eventActions({ ...base, type: "CAMP" }, { hasFee: false, hasOther: true })[0]?.label,
    "Register",
  );
  eq(
    "a membership drive says Join or renew",
    eventActions({ ...base, type: "MEMBERSHIP_DRIVE" }, { hasFee: false, hasOther: true })[0]
      ?.label,
    "Join or renew",
  );
  eq(
    "an unrecognised type still gets a working label",
    eventActions({ ...base, type: "WHATEVER" }, { hasFee: false, hasOther: true })[0]?.label,
    "Register",
  );

  // An event with no active caps is absent from the offering-kinds map, and the
  // register door is the safe default — the `?? true` the listing relies on.
  eq(
    "no offering data falls back to the register door",
    eventActions(base, undefined)[0]?.key,
    "register",
  );

  const closed = eventActions(
    { ...base, offersRegistration: false, offersVolunteers: true, offersVendors: true },
    { hasFee: true, hasOther: true },
  );
  check(
    "offersRegistration false closes BOTH sale doors",
    !closed.some((a) => a.key === "register" || a.key === "perform"),
    JSON.stringify(closed.map((a) => a.key)),
  );
  eq(
    "…while volunteer and vendor survive",
    closed.map((a) => a.key),
    ["volunteer", "vendor"],
  );

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n§6  saleSummaryByEvent — one grouped read for the page");

  // Structural, read as text: the whole reason this function exists is ONE
  // query for the page rather than one per card. A resolvePrice in a loop over
  // separate reads is the shape it replaced, so the row that guards the shape
  // cannot itself be a runtime call.
  const salesSrc = readFileSync("src/server/eventSales.ts", "utf8");
  const dbCalls = salesSrc.match(/\bdb\.[a-zA-Z]+\.[a-zA-Z]+\(/g) ?? [];
  eq("the module issues exactly one database call", dbCalls.length, 1);
  check(
    "…and it is a grouped findMany over eventId",
    /findMany\(/.test(salesSrc) && /eventId: \{ in:/.test(salesSrc),
    dbCalls.join(","),
  );
  // Comments are stripped first: this file TALKS about ServiceCap.priceCents in
  // prose, and a naive grep flagged its own explanation.
  const salesCode = salesSrc
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  check(
    "…and it resolves through resolvePrice rather than reading a price column",
    /resolvePrice\(/.test(salesCode) &&
      !/\.priceCents/.test(salesCode.replace(/priceCents: true/g, "")),
    "a priceCents member read outside the select",
  );

  // The card must not advertise a price for a door that is shut. DIW-2026 sits
  // in the database with offersRegistration false beside a live capped $30
  // competition offering, so its only action is Volunteer — and "$30 a group"
  // over a Volunteer button is a price nobody can pay. Structural, because the
  // rule lives in the component and this suite does not render components.
  const cardSrc = readFileSync("src/app/_components/EventPosterCard.tsx", "utf8");
  check(
    "the card gates its price line on an open sale door",
    /const sellable =/.test(cardSrc) &&
      /sellable && sale\?\.priceLine/.test(cardSrc) &&
      /sellable && sale\?\.capacityLine/.test(cardSrc),
    "price or capacity rendered without the sellable guard",
  );

  // One event is not a rail, and zero events must still reach the untouched
  // empty state. Structural rather than rendered: exercising those two branches
  // live would mean rewriting event statuses in a database that holds 323 real
  // member households, which is not a thing a test suite should do.
  const railSrc = readFileSync("src/app/_components/EventRail.tsx", "utf8");
  check(
    "a single event renders the cards with no rail and no dots",
    /const isRail = labels\.length > 1;/.test(railSrc) && /if \(!isRail\)/.test(railSrc),
    "the single-event branch is gone",
  );
  check(
    "the dots row exists only alongside the scroller",
    railSrc.indexOf('aria-label={`Show ') > railSrc.indexOf("if (!isRail)"),
    "dots render before the single-event early return",
  );
  const pageSrc = readFileSync("src/app/page.tsx", "utf8");
  check(
    "zero events still fall through to the untouched empty state",
    /events\.length > 0 \?/.test(pageSrc) && /<EmptyEventsState \/>/.test(pageSrc),
    "the empty-state branch is gone",
  );
  // Comments stripped: page.tsx's own doc comment explains WHY PageHelp was
  // removed and where it still belongs, so a naive grep flags the explanation.
  const stripComments = (src: string) =>
    src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
  check(
    "the home page no longer mounts PageHelp",
    !/PageHelp/.test(stripComments(pageSrc)),
    "PageHelp is back on the front door",
  );

  const { saleSummaryByEvent } = await import("../src/server/eventSales");
  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  const admitType = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: ADMIT_KEY } },
    update: { kind: "ADMISSION", name: "Floor Entry", active: true },
    create: {
      orgId: org.id,
      key: ADMIT_KEY,
      name: "Floor Entry",
      priceCents: 1200,
      kind: "ADMISSION",
    },
  });
  const feeType = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: FEE_KEY } },
    update: { kind: "FEE", name: "Competition Entry", active: true },
    create: {
      orgId: org.id,
      key: FEE_KEY,
      name: "Competition Entry",
      priceCents: 3000,
      kind: "FEE",
    },
  });
  const merchType = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: MERCH_KEY } },
    update: { kind: "MERCH", name: "Dandiya Sticks", active: true },
    create: {
      orgId: org.id,
      key: MERCH_KEY,
      name: "Dandiya Sticks",
      priceCents: 500,
      kind: "MERCH",
    },
  });

  const freeType = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: FREE_KEY } },
    update: { kind: "ADMISSION", name: "General Consult", active: true },
    create: {
      orgId: org.id,
      key: FREE_KEY,
      name: "General Consult",
      priceCents: 0,
      kind: "ADMISSION",
    },
  });

  // Relative dates, never literals: a hardcoded endsAt turns this suite red the
  // day it passes — a time bomb, not a test. Anchored at 18:00Z (1 PM CDT) so
  // that +1h and +6h stay inside the same VENUE day, which is what the
  // same-evening grouping is keyed on.
  const anchorDate = new Date(Date.now() + 30 * 24 * 3600_000);
  const START = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate(),
    18,
    0,
    0,
  );
  const VENUE = "McKamy Middle School, Flower Mound, TX";

  const mkEvent = (code: string, extra: Record<string, unknown> = {}) =>
    db.event.create({
      data: {
        orgId: org.id,
        type: "GENERAL",
        status: "OPEN",
        code,
        name: `Home Verify ${code}`,
        startsAt: new Date(START),
        endsAt: new Date(START + 4 * 3600_000),
        collectsAttendeeDetails: false,
        location: VENUE,
        ...extra,
      },
    });

  const deadline = new Date(START - 5 * 24 * 3600_000);

  const evAdmit = await mkEvent(CODE_ADMIT);
  await db.serviceCap.create({
    data: {
      eventId: evAdmit.id,
      serviceTypeId: admitType.id,
      priceCents: 1200,
      onsitePriceCents: 1500,
      earlyBirdPriceCents: 1000,
      earlyBirdUntil: deadline,
      capacity: 40,
      sold: 33,
    },
  });

  // Same venue day, same venue — the Navratri/Dandiya shape.
  const evFeeSameNight = await mkEvent(CODE_FEE, {
    startsAt: new Date(START + 3600_000),
    endsAt: new Date(START + 6 * 3600_000),
  });
  await db.serviceCap.create({
    data: {
      eventId: evFeeSameNight.id,
      serviceTypeId: feeType.id,
      priceCents: 3000,
      capacity: 25,
    },
  });

  // Same day, DIFFERENT venue — must not pair with anything.
  const evElsewhere = await mkEvent(CODE_ELSEWHERE, {
    location: "Gerault Park, Flower Mound, TX",
  });
  await db.serviceCap.create({
    data: {
      eventId: evElsewhere.id,
      serviceTypeId: feeType.id,
      priceCents: 3000,
      capacity: null,
    },
  });

  // Merch only: sells something, admits nobody, charges nothing at a door.
  const evMerch = await mkEvent(CODE_MERCH, { location: null });
  await db.serviceCap.create({
    data: {
      eventId: evMerch.id,
      serviceTypeId: merchType.id,
      priceCents: 500,
      capacity: 500,
    },
  });

  // No offerings at all — unconfigured, which is not the same as free.
  const evBare = await mkEvent(CODE_BARE, { location: null });

  // The test camp's shape: a $0 service beside paid ones. Taking the cheapest
  // admission made a paid medical camp announce "Free entry" on the front page.
  const evMixed = await mkEvent(CODE_MIXED, { type: "CAMP", location: null });
  await db.serviceCap.create({
    data: { eventId: evMixed.id, serviceTypeId: freeType.id, priceCents: 0, capacity: 200 },
  });
  await db.serviceCap.create({
    data: { eventId: evMixed.id, serviceTypeId: admitType.id, priceCents: 1500, capacity: 200 },
  });

  const inputs = [evAdmit, evFeeSameNight, evElsewhere, evMerch, evBare, evMixed].map((e) => ({
    id: e.id,
    name: e.name,
    startsAt: e.startsAt,
    location: e.location,
  }));

  const beforeDeadline = new Date(deadline.getTime() - 24 * 3600_000);
  const afterDeadline = new Date(deadline.getTime() + 24 * 3600_000);
  const early = await saleSummaryByEvent(inputs, beforeDeadline);
  const late = await saleSummaryByEvent(inputs, afterDeadline);

  const earlyLine = early.get(evAdmit.id)?.priceLine ?? "";
  check(
    "an early-bird admission resolves its promotional phase",
    /^\$10 through [A-Z][a-z]{2} \d{1,2}, then \$12$/.test(earlyLine),
    earlyLine,
  );
  eq(
    "the same event past its deadline names the door instead",
    late.get(evAdmit.id)?.priceLine,
    "$12 · $15 at the door",
  );
  eq("7 of 40 left is reported", early.get(evAdmit.id)?.capacityLine, "7 spots left");

  eq(
    "a fee-only event reads as free entry plus a group fee",
    early.get(evFeeSameNight.id)?.priceLine,
    "Free entry · $30 a group",
  );
  // 25 of 25 remaining: a real ceiling, but nobody is near it.
  eq(
    "…and prints no capacity line while nobody is near the cap",
    early.get(evFeeSameNight.id)?.capacityLine,
    null,
  );

  eq("an uncapped fee reports no capacity line", early.get(evElsewhere.id)?.capacityLine, null);

  const merchLine = early.get(evMerch.id)?.priceLine;
  eq("a merch-only event does not price merch as entry", merchLine, "Free entry");
  check(
    "…and never quotes the merch price as a door price",
    !(merchLine ?? "").includes("$5"),
    merchLine ?? "",
  );

  check(
    "an event with no active offerings is ABSENT from the map, not null-filled",
    !early.has(evBare.id),
    `map holds ${[...early.keys()].length} of ${inputs.length}`,
  );

  eq(
    "two events on one venue day at one venue name each other",
    early.get(evAdmit.id)?.sameEveningAs?.name,
    evFeeSameNight.name,
  );
  eq("…symmetrically", early.get(evFeeSameNight.id)?.sameEveningAs?.name, evAdmit.name);
  check(
    "openFloor marks the side that admits people, not the competition",
    early.get(evAdmit.id)?.sameEveningAs?.openFloor === true &&
      early.get(evFeeSameNight.id)?.sameEveningAs?.openFloor === false,
    JSON.stringify([
      early.get(evAdmit.id)?.sameEveningAs,
      early.get(evFeeSameNight.id)?.sameEveningAs,
    ]),
  );
  eq(
    "the same day at a DIFFERENT venue is not the same evening",
    early.get(evElsewhere.id)?.sameEveningAs ?? null,
    null,
  );
  eq(
    "an event with no location is never paired",
    early.get(evMerch.id)?.sameEveningAs ?? null,
    null,
  );

  // A single free service is not a free door.
  eq(
    "a $0 service beside paid ones does NOT make the event free entry",
    early.get(evMixed.id)?.priceLine,
    "$15",
  );

  eq("an empty event list returns an empty map", (await saleSummaryByEvent([], beforeDeadline)).size, 0);

  await cleanup(org.id);
}

async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({ where: { orgId, code: { in: ALL_CODES } } });
  for (const event of events) {
    const orders = await db.order.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    // Payment.orderId is SetNull, not cascade, so these go first and in this
    // order or the event delete fails on a live FK.
    await db.ledgerEntry.deleteMany({
      where: { paymentId: { in: payments.map((p) => p.id) } },
    });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.event.delete({ where: { id: event.id } });
  }
  await db.serviceType.deleteMany({ where: { orgId, key: { in: ALL_KEYS } } });
}

main()
  .then(async () => {
    await db.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
