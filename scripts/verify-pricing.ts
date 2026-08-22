/**
 * Pricing regression check — run against a scratch event, then clean up.
 *
 *   ENV_FILE=.env npx tsx scripts/verify-pricing.ts
 *
 * Covers the three defects fixed on 2026-08-16, all of which only bite in
 * QUANTITY mode (admission/merch events like dandiya), which is why the camp
 * flows never surfaced them:
 *
 *   1. createCheckoutForOrder ignored LineItem.quantity — Stripe under-charged
 *      while confirmOrderPaid recorded the quantity-aware total.
 *   2. The membership comp zeroed EVERY admission line instead of the family's
 *      party size, so one membership could comp unlimited tickets.
 *   3. upsertMember ran at cart creation, so an abandoned PENDING order minted
 *      a real, non-purgeable membership term for free.
 *
 * There is no test framework in this repo (a deliberate call — see the Oct 10
 * deadline). This script is the money-path safety net until one lands.
 */
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-PRICING";
const EMAIL = "verify-pricing@example.test";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  PASS" : "  FAIL"}  ${label}` +
      (ok ? "" : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

/** Sum an order the way createCheckoutForOrder now does (quantity-aware). */
async function checkoutTotal(orderId: string): Promise<number> {
  const lines = await db.lineItem.findMany({ where: { orderId } });
  return lines.reduce((s, li) => s + li.amountCents * li.quantity, 0);
}

async function main(): Promise<void> {
  const { createRegistration, isRegistrationOpen } = await import("../src/server/registration");
  const { confirmOrderPaid } = await import("../src/server/payments");
  const { resolvePrice } = await import("../src/lib/pricing");

  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  // ── Scratch event: quantity mode, honors membership ──
  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "OPEN",
      code: CODE,
      name: "Pricing Verification",
      // Relative to now, never a literal date: isRegistrationOpen now refuses a
      // finished event, so a hardcoded endsAt would turn this whole script red
      // the day it passed — a time bomb, not a test.
      startsAt: new Date(Date.now() + 30 * 24 * 3600_000),
      endsAt: new Date(Date.now() + 30 * 24 * 3600_000 + 4 * 3600_000),
      collectsAttendeeDetails: false,
      honorsMembership: true,
    },
  });

  const entry = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-entry" } },
    update: { kind: "ADMISSION", priceCents: 1500 },
    create: { orgId: org.id, key: "verify-entry", name: "Entry", priceCents: 1500, kind: "ADMISSION" },
  });
  const sticks = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-sticks" } },
    update: { kind: "MERCH", priceCents: 500 },
    create: { orgId: org.id, key: "verify-sticks", name: "Sticks", priceCents: 500, kind: "MERCH" },
  });
  // A pure fee: neither admission nor merch. Mints no ticket, grants no entry.
  const fee = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-fee" } },
    update: { kind: "FEE", priceCents: 3000 },
    create: { orgId: org.id, key: "verify-fee", name: "Competition Entry", priceCents: 3000, kind: "FEE" },
  });
  for (const s of [entry, sticks, fee]) {
    await db.serviceCap.create({
      data: {
        eventId: event.id, serviceTypeId: s.id, priceCents: s.priceCents,
        // Door price only on admission: $15 online, $20 walk-up.
        onsitePriceCents: s.id === entry.id ? 2000 : null,
        capacity: 1000,
      },
    });
  }

  // A third price: promotional early-bird, online only, gone after the
  // deadline. earlyBirdUntil is set far in the future (real wall-clock, not a
  // pinned `now`) so the end-to-end test in section 7 — which goes through
  // createRegistration and therefore the real `new Date()` — is always inside
  // the window.
  const earlyBird = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-earlybird" } },
    update: { kind: "ADMISSION", priceCents: 1500 },
    create: { orgId: org.id, key: "verify-earlybird", name: "Early Bird Entry", priceCents: 1500, kind: "ADMISSION" },
  });
  await db.serviceCap.create({
    data: {
      eventId: event.id,
      serviceTypeId: earlyBird.id,
      priceCents: 1500,
      onsitePriceCents: 2000,
      earlyBirdPriceCents: 1000,
      earlyBirdUntil: new Date("2030-01-01T00:00:00Z"),
      capacity: 1000,
    },
  });

  const plan = await db.membershipPlan.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-family" } },
    update: { partySize: 4, priceCents: 5000, termYears: 1 },
    create: {
      orgId: org.id, key: "verify-family", name: "Verify Family",
      termYears: 1, priceCents: 5000, partySize: 4,
    },
  });

  const registrant = { name: "Verify Buyer", email: EMAIL, phone: "555-0100" };

  // ── 1. Quantity-aware total: 2 × $15 + 5 × $5 = $55 ──
  console.log("\n1. Quantity-aware checkout total");
  const plainOrder = await createRegistration({
    eventId: event.id,
    registrant,
    marketingConsent: false,
    quantities: [
      { serviceKey: "verify-entry", quantity: 2 },
      { serviceKey: "verify-sticks", quantity: 5 },
    ],
  });
  check("createRegistration total is $55.00", plainOrder.totalCents, 5500);
  check("Stripe-side total matches the ledger-side total", await checkoutTotal(plainOrder.orderId), 5500);
  check(
    "2 admission units mint 2 scannable tickets",
    await db.attendee.count({ where: { orderId: plainOrder.orderId } }),
    2,
  );

  // ── 2. Comp is capped at the plan's party size (4 of 6 free) ──
  console.log("\n2. Membership comp capped at party size");
  const compOrder = await createRegistration({
    eventId: event.id,
    registrant,
    marketingConsent: false,
    membershipPlanId: plan.id,
    quantities: [{ serviceKey: "verify-entry", quantity: 6 }],
  });
  // 4 comped + 2 × $15 + $50 membership = $80
  check("6 tickets with a 4-person membership costs $80.00", compOrder.totalCents, 8000);
  const compLines = await db.lineItem.findMany({
    where: { orderId: compOrder.orderId, serviceTypeId: entry.id },
    orderBy: { amountCents: "asc" },
  });
  check(
    "admission splits into a comped line and a paid line",
    compLines.map((l) => [l.amountCents, l.quantity]),
    [[0, 4], [1500, 2]],
  );
  check(
    "all 6 guests still get a scannable ticket",
    await db.attendee.count({ where: { orderId: compOrder.orderId } }),
    6,
  );

  // ── 3. An unpaid order must NOT mint a membership ──
  console.log("\n3. Membership is minted only on payment");
  check(
    "no Member row exists while the order is PENDING",
    await db.member.count({ where: { orgId: org.id, email: EMAIL } }),
    0,
  );
  await confirmOrderPaid(compOrder.orderId, { method: "CASH", idempotencyKey: `verify-${compOrder.orderId}` });
  check(
    "Member row exists once the order is CONFIRMED",
    await db.member.count({ where: { orgId: org.id, email: EMAIL } }),
    1,
  );

  // ── 4. ATTENDEE (camp) mode still prices correctly after the refactor ──
  // The comp allocation was rewritten to a single pricing pass; this is the
  // medical-camp path, so a regression here breaks the primary module.
  console.log("\n4. Attendee/camp mode unaffected");
  const camp = await db.event.create({
    data: {
      orgId: org.id, type: "CAMP", status: "OPEN", code: `${CODE}-CAMP`,
      name: "Pricing Verification Camp",
      // Relative to now, for the same reason the GENERAL scratch event above is
      // — and this one was the more dangerous miss. Its status is OPEN, so the
      // ACTIVE/walk-in carve-out does NOT exempt it from the clock, and the
      // createRegistration call below would THROW the day a literal endsAt
      // passed. An unguarded throw at the top of main() does not report a red
      // assertion: it kills the run, so sections 5-8 would never execute at all.
      startsAt: new Date(Date.now() + 30 * 24 * 3600_000),
      endsAt: new Date(Date.now() + 30 * 24 * 3600_000 + 4 * 3600_000),
      collectsAttendeeDetails: true,
      honorsMembership: false,
    },
  });
  for (const s of [entry, sticks]) {
    await db.serviceCap.create({
      data: { eventId: camp.id, serviceTypeId: s.id, priceCents: s.priceCents, capacity: 1000 },
    });
  }
  const campOrder = await createRegistration({
    eventId: camp.id,
    registrant,
    marketingConsent: false,
    attendees: [
      { name: "Patient One", serviceKeys: ["verify-entry", "verify-sticks"] },
      { name: "Patient Two", serviceKeys: ["verify-entry"] },
    ],
  });
  // 2 × $15 + 1 × $5, no comp (honorsMembership false) = $35
  check("two patients with per-person services costs $35.00", campOrder.totalCents, 3500);
  check(
    "one attendee row per person",
    await db.attendee.count({ where: { orderId: campOrder.orderId } }),
    2,
  );
  check(
    "every line is qty 1 and attached to an attendee",
    (await db.lineItem.findMany({ where: { orderId: campOrder.orderId } })).every(
      (l) => l.quantity === 1 && l.attendeeId !== null,
    ),
    true,
  );

  // ── 5. A fee issues no ticket and is never comped ──
  console.log("\n5. Fee-kind service (competition entry)");
  // allowFeeServices: this section is about PRICING a fee (no ticket, never
  // comped), not about which form may sell one. createRegistration now refuses
  // fee-kind services to public callers, because /register sold a real $25 RoN
  // entry with no group details attached; src/server/performance.ts is the only
  // production caller that passes this. Keeping the pricing assertions here
  // means the fee's money behaviour stays pinned independently of that policy.
  const feeOrder = await createRegistration(
    {
      eventId: event.id,
      registrant: { ...registrant, email: "verify-fee@example.test" },
      marketingConsent: false,
      membershipPlanId: plan.id,
      quantities: [
        { serviceKey: "verify-entry", quantity: 2 },
        { serviceKey: "verify-fee", quantity: 3 },
      ],
    },
    { allowFeeServices: true },
  );
  check(
    "3 competition groups + 2 comped admissions mint only 2 tickets",
    await db.attendee.count({ where: { orderId: feeOrder.orderId } }),
    2,
  );
  // 2 admissions comped by the membership, 3 fees at $30 untouched, plan $50.
  check("the membership comps admission but not the fee", feeOrder.totalCents, 9000 + 5000);
  check(
    "door price is stored separately from the online price",
    (await db.serviceCap.findFirstOrThrow({
      where: { eventId: event.id, serviceTypeId: entry.id },
      select: { priceCents: true, onsitePriceCents: true },
    })),
    { priceCents: 1500, onsitePriceCents: 2000 },
  );

  // ── 6. Early-bird pricing: a third price, resolved pure ──
  // Against a cap with priceCents 1500 / onsitePriceCents 2000 /
  // earlyBirdPriceCents 1000. Pinning `now` on both sides of the deadline
  // exercises resolvePrice directly — no DB round trip needed since it's pure.
  console.log("\n6. Early-bird price resolution (resolvePrice, pinned time)");
  const earlyBirdCap = {
    priceCents: 1500,
    onsitePriceCents: 2000,
    earlyBirdPriceCents: 1000,
    earlyBirdUntil: new Date("2026-01-01T00:00:00Z"),
  };
  const beforeDeadline = new Date("2025-12-01T00:00:00Z");
  const afterDeadline = new Date("2026-02-01T00:00:00Z");

  const onlineBefore = resolvePrice(earlyBirdCap, "online", beforeDeadline);
  check("online before deadline: charges the early-bird price", onlineBefore.amountCents, 1000);
  check("online before deadline: phase is early-bird", onlineBefore.phase, "early-bird");
  check("online before deadline: nextAmountCents is the regular online price", onlineBefore.nextAmountCents, 1500);

  const onlineAfter = resolvePrice(earlyBirdCap, "online", afterDeadline);
  check("online after deadline: charges the regular online price", onlineAfter.amountCents, 1500);
  check("online after deadline: phase is online", onlineAfter.phase, "online");
  check("online after deadline: nextAmountCents is the door price", onlineAfter.nextAmountCents, 2000);

  const doorBefore = resolvePrice(earlyBirdCap, "door", beforeDeadline);
  check("door before deadline: ignores early bird, charges the door price", doorBefore.amountCents, 2000);
  check("door before deadline: phase is door", doorBefore.phase, "door");

  const doorAfter = resolvePrice(earlyBirdCap, "door", afterDeadline);
  check("door after deadline: still the door price", doorAfter.amountCents, 2000);
  check("door after deadline: phase is door", doorAfter.phase, "door");

  const halfConfigured = {
    priceCents: 1500,
    onsitePriceCents: 2000,
    earlyBirdPriceCents: 1000,
    earlyBirdUntil: null,
  };
  const halfConfiguredOnline = resolvePrice(halfConfigured, "online", beforeDeadline);
  check("price set but no deadline: resolves as if there were no early bird", halfConfiguredOnline.amountCents, 1500);
  check("price set but no deadline: phase is online, not early-bird", halfConfiguredOnline.phase, "online");

  // ── 7. Early bird end to end, through createRegistration ──
  // Proves the AUTHORITATIVE server path (not just the resolver in isolation)
  // charges the early-bird price during an open window. Uses the earlyBird cap
  // created above, whose deadline is 2030 — real wall-clock `now`, since
  // createRegistration resolves with `new Date()` and cannot be pinned from
  // outside.
  console.log("\n7. Early bird charged end to end through createRegistration");
  const earlyBirdOrder = await createRegistration({
    eventId: event.id,
    registrant: { ...registrant, email: "verify-earlybird@example.test" },
    marketingConsent: false,
    quantities: [{ serviceKey: "verify-earlybird", quantity: 1 }],
  });
  check("order total is the early-bird price, not the regular online price", earlyBirdOrder.totalCents, 1000);
  const earlyBirdLine = await db.lineItem.findFirstOrThrow({
    where: { orderId: earlyBirdOrder.orderId, serviceTypeId: earlyBird.id },
  });
  check("the frozen line item itself carries the early-bird price", earlyBirdLine.amountCents, 1000);

  // ── 8. A finished event stops selling (pure predicate, no rows needed) ──
  // `isRegistrationOpen` gates BOTH the public form and createRegistration, so
  // these assertions are the online sell/no-sell rule across the four statuses
  // Test-Plan A-6 specifies — DRAFT, OPEN, ACTIVE and CLOSED. That is NOT the
  // whole enum: `prisma/schema.prisma` defines six, and the two missing ones
  // need no rows of their own because PURGEABLE and PURGED reach `false` down
  // the same non-ACTIVE path the CLOSED row at the end of this section already
  // pins. No count is stated on purpose — a hand-maintained total was corrected
  // twice in two tasks and decays silently the moment anyone adds a row, so the
  // rows are their own tally. `now` is injected, which is the only way to sit on
  // both sides of the boundary without waiting for the clock.
  console.log("\n8. isRegistrationOpen: a finished event stops selling");
  const now = new Date("2026-10-10T18:00:00Z");
  const future = new Date(now.getTime() + 3600_000);
  const past = new Date(now.getTime() - 3600_000);
  const walkIn = new Date(now.getTime() - 7200_000);

  check(
    "OPEN and not yet over: sells",
    isRegistrationOpen({ status: "OPEN", walkInOpensAt: null, endsAt: future }, now),
    true,
  );
  check(
    "OPEN but already over: does NOT sell",
    isRegistrationOpen({ status: "OPEN", walkInOpensAt: null, endsAt: past }, now),
    false,
  );
  check(
    "ACTIVE with walk-in open, not yet over: sells",
    isRegistrationOpen({ status: "ACTIVE", walkInOpensAt: walkIn, endsAt: future }, now),
    true,
  );
  // Ruling, 2026-08-18: the clock gates OPEN only. A door a coordinator opened
  // TODAY outranks the scheduled end — a camp booked 8am-1pm that runs to 2:30pm
  // must keep taking walk-ins, and for a camp /register is the only walk-in path
  // (gate.ts is GENERAL-only). This is not a weakened test, and the carve-out
  // has TWO conditions, each pinned by its own row. The DOOR axis
  // (`walkInOpensAt !== null`) is pinned by the NULL pair immediately below. The
  // STATUS axis (`status === "ACTIVE"`) is pinned by the CLOSED row at the end
  // of this section — the walk-in toggle is rendered only while the camp is
  // ACTIVE (`CampControls.tsx:85`) and CLOSED has no transition back to ACTIVE
  // (`actions.ts:18`), so a camp closed without first closing its door sits in
  // CLOSED with `walkInOpensAt` still set and nothing left in the UI that could
  // clear it — and the status test is the only thing between that row and live
  // online sales.
  check(
    "ACTIVE with walk-in OPENED and already over: still sells — an opened door outranks the scheduled end",
    isRegistrationOpen({ status: "ACTIVE", walkInOpensAt: walkIn, endsAt: past }, now),
    true,
  );
  // The other half of the pair. The carve-out turns on the opened door, not on
  // ACTIVE alone — this shape is GB-2026W, ACTIVE with walkInOpensAt NULL and
  // long past, and it must stay refused.
  check(
    "ACTIVE with walk-in NOT opened and already over: does NOT sell — the carve-out is the door, not the status",
    isRegistrationOpen({ status: "ACTIVE", walkInOpensAt: null, endsAt: past }, now),
    false,
  );
  // Pre-existing rule, asserted here so this task cannot quietly undo it:
  // mid-event is not by itself permission to keep selling online.
  check(
    "ACTIVE with walk-in NOT opened: does NOT sell even though the event is live",
    isRegistrationOpen({ status: "ACTIVE", walkInOpensAt: null, endsAt: future }, now),
    false,
  );
  // The endsAt-not-startsAt guarantee. Doors opened hours ago and the floor
  // runs past midnight; the form must stay open. Anyone who "fixes" the filter
  // to startsAt fails exactly this line.
  // Not a fresh literal, so the extra `startsAt` is allowed through: the point
  // of this row is that a started-but-unfinished event carries one.
  const inProgress = { status: "OPEN", walkInOpensAt: null, startsAt: past, endsAt: future };
  check(
    "in progress (started in the past, ends in the future): still sells",
    isRegistrationOpen(inProgress, now),
    true,
  );
  // The equality boundary. The predicate says `endsAt >= now` and the list
  // queries say `gte` — they agree today and nothing pinned it. Tighten either
  // side to a strict `>` and the page silently disagrees with the predicate for
  // the one instant an event ends on.
  check(
    "OPEN with endsAt exactly === now: still sells (>=, matching the lists' gte)",
    isRegistrationOpen({ status: "OPEN", walkInOpensAt: null, endsAt: now }, now),
    true,
  );
  // The camp-day narrative, end to end: a half-day medical camp scheduled to
  // finish 90 minutes ago, still on the floor, walk-in selling opened this
  // morning. A real camp overrunning its window is what this row protects — if it
  // ever flips to false, walk-ins lose /register mid-camp with nowhere else to go.
  const overrunningCamp = {
    type: "CAMP",
    status: "ACTIVE",
    walkInOpensAt: walkIn,
    endsAt: new Date(now.getTime() - 90 * 60_000),
  };
  check(
    "a CAMP running 90 minutes past its scheduled end, walk-in open: still sells",
    isRegistrationOpen(overrunningCamp, now),
    true,
  );
  // The STATUS axis of the carve-out. This is the realistic post-camp row shape:
  // a camp that ran, opened its walk-in door, and was closed. `transitionCamp`
  // to CLOSED writes only `status` and `closedAt` (`actions.ts:118-125`), and
  // `setWalkIn` is the only writer that can CLEAR `walkInOpensAt`
  // (`actions.ts:167`) — `prisma/seed-test.ts:209` writes the column too, but
  // only ever sets it, and never at runtime. That writer CAN null the column
  // — `walkInOpensAt: open ? new Date() : null` —
  // but the only caller is a toggle (`CampControls.tsx:55`) rendered inside
  // `{status === "ACTIVE" && (…)}` (`CampControls.tsx:85`), and the `NEXT` map
  // gives CLOSED exactly one onward transition, PURGEABLE, with no path back to
  // ACTIVE (`actions.ts:18`). So once a camp reaches CLOSED with its door set
  // the control that could clear it is gone and unreachable: this shape is
  // PERMANENT for every camp closed without first closing its door. (`setWalkIn`
  // carries no status guard of its own, so a direct action call could still null
  // it — a deliberate act, not the default state.) Drop `status === "ACTIVE"`
  // from the predicate as "redundant" and this line is what goes red; without
  // it, every closed camp becomes sellable by direct link and joins bare
  // `/register`'s candidate pool.
  check(
    "CLOSED with walk-in still set and already over: does NOT sell — the status test is the only thing refusing it",
    isRegistrationOpen({ status: "CLOSED", walkInOpensAt: walkIn, endsAt: past }, now),
    false,
  );
  // The fourth status. `endsAt` is deliberately in the FUTURE so nothing but the
  // status can be doing the refusing: an unpublished event must never sell, and
  // the predicate reaches it by falling through both arms rather than by an
  // explicit DRAFT test, which is exactly the behaviour worth pinning.
  check(
    "DRAFT with a future endsAt: does NOT sell — an unpublished event is not a sellable one",
    isRegistrationOpen({ status: "DRAFT", walkInOpensAt: null, endsAt: future }, now),
    false,
  );

  await cleanup(org.id);
}

/** Remove everything this script creates (cascades don't cover payments/ledger). */
async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({
    where: { orgId, code: { in: [CODE, `${CODE}-CAMP`] } },
  });
  for (const event of events) {
    const orders = await db.order.findMany({ where: { eventId: event.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } }, select: { id: true },
    });
    await db.ledgerEntry.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.event.delete({ where: { id: event.id } }); // cascades orders/attendees/lines
  }
  await db.member.deleteMany({ where: { orgId, email: EMAIL } });
  await db.membershipPlan.deleteMany({ where: { orgId, key: "verify-family" } });
  // Every key this script creates must appear here. A suite that leaks rows into
  // a shared dev database silently changes what the next manual test sees —
  // `verify-earlybird` escaped exactly that way.
  await db.serviceType.deleteMany({
    where: {
      orgId,
      key: { in: ["verify-entry", "verify-sticks", "verify-fee", "verify-earlybird"] },
    },
  });
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
