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
  const { createRegistration } = await import("../src/server/registration");
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
      startsAt: new Date("2026-12-01T00:00:00Z"),
      endsAt: new Date("2026-12-01T04:00:00Z"),
      collectsAttendeeDetails: false,
      honorsMembership: true,
    },
  });

  const entry = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-entry" } },
    update: { fulfillable: false, admits: true, priceCents: 1500 },
    create: { orgId: org.id, key: "verify-entry", name: "Entry", priceCents: 1500, fulfillable: false, admits: true },
  });
  const sticks = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-sticks" } },
    update: { fulfillable: true, admits: false, priceCents: 500 },
    create: { orgId: org.id, key: "verify-sticks", name: "Sticks", priceCents: 500, fulfillable: true, admits: false },
  });
  // A pure fee: neither admission nor merch. Mints no ticket, grants no entry.
  const fee = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "verify-fee" } },
    update: { fulfillable: false, admits: false, priceCents: 3000 },
    create: { orgId: org.id, key: "verify-fee", name: "Competition Entry", priceCents: 3000, fulfillable: false, admits: false },
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
    update: { fulfillable: false, admits: true, priceCents: 1500 },
    create: { orgId: org.id, key: "verify-earlybird", name: "Early Bird Entry", priceCents: 1500, fulfillable: false, admits: true },
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
      startsAt: new Date("2026-12-02T00:00:00Z"),
      endsAt: new Date("2026-12-02T04:00:00Z"),
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
  const feeOrder = await createRegistration({
    eventId: event.id,
    registrant: { ...registrant, email: "verify-fee@example.test" },
    marketingConsent: false,
    membershipPlanId: plan.id,
    quantities: [
      { serviceKey: "verify-entry", quantity: 2 },
      { serviceKey: "verify-fee", quantity: 3 },
    ],
  });
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
