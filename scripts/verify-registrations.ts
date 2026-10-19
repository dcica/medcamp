/**
 * Event sales check — what "N registered" is allowed to mean.
 *
 *   ENV_FILE=.env npx tsx scripts/verify-registrations.ts
 *
 * Sibling of verify-checkout.ts (the buyer who left) and verify-readiness.ts
 * (the setup checklist). This one covers the number a coordinator reads AFTER
 * the buyers have been through.
 *
 * WHY THIS FILE EXISTS. /admin/camps/[id] printed a raw `_count.attendees` and
 * called it "registered". Attendee rows are minted at CART creation on a
 * PENDING order (src/server/registration.ts) and nothing ever reaps the
 * abandoned ones, so the number silently included people who never paid — and
 * on a quantity-mode event it counted admitted HEADS, so one "family of 4"
 * purchase read as four registrations. Meanwhile /dashboard counted
 * `campId != null` and got a different answer for the same event. Two screens,
 * two definitions, same word.
 *
 * WHAT THIS PINS:
 *
 *   1. AN ABANDONED CART IS NOT A REGISTRATION. This is the whole defect. The
 *      failure is entirely in what does NOT happen — no error, no red, just a
 *      number that reads high — so nothing else would ever notice.
 *
 *   2. COLLECTED MONEY IS `SUCCEEDED` PAYMENTS, NOT `Payment` ROWS. A PENDING
 *      Payment is a Stripe session somebody opened. Counting it is the same
 *      class of mistake as counting the cart.
 *
 *   3. THE PAID COUNT AND THE ORDER LIST AGREE. A summary that disagrees with
 *      the rows printed under it is worse than either alone, because there is
 *      no way to tell from the screen which one lied.
 *
 *   4. LINE TOTALS ARE amountCents × quantity. A five-stick line is ONE row
 *      worth five sticks; summing bare amountCents under-reports merch revenue
 *      and nothing downstream would catch it.
 *
 *   5. DONATIONS AND MEMBERSHIP ARE BROKEN OUT, not folded into service
 *      revenue — the split the treasurer reconciles against.
 *
 * ── MUTATION TESTS (each was made once, observed red, and reverted) ──
 *   §1  drop the `campId != null` filter and count o.attendees.length
 *                                                    → abandoned-cart rows fail
 *   §2  count every payment instead of `status === "SUCCEEDED"`
 *                                                    → collected rows fail
 *   §3  sum `li.amountCents` without `* li.quantity` → quantity rows fail
 *   §4  drop the `isDonation` branch                 → break-out rows fail
 */
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// Same reasoning as verify-checkout.ts: the machine has a global DATABASE_URL
// pointing at an unrelated project and dotenv will not override an already-set
// shell var without this. Every src import below is therefore a dynamic
// `await import`, so nothing constructs Prisma against the stale value.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-REGS";
const ADMIT_KEY = "verify-regs-admit";
const MERCH_KEY = "verify-regs-merch";
const DOUBLES_KEY = "verify-regs-doubles";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { getEventRegistrations } = await import("../src/server/registrations");

  const org = await db.organization.findUniqueOrThrow({
    // Pin the org getActiveOrg() resolves in script scope — DEFAULT_ORG_SLUG — so
    // fixtures land where the code under test looks, not in "the oldest row".
    where: { slug: process.env.DEFAULT_ORG_SLUG ?? "dcica" },
  });
  await cleanup(org.id);

  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "OPEN",
      code: CODE,
      name: "Registrations Verification",
      // Relative, never a literal: a hardcoded date turns this red the day it passes.
      startsAt: new Date(Date.now() + 20 * 24 * 3600_000),
      endsAt: new Date(Date.now() + 20 * 24 * 3600_000 + 3 * 3600_000),
      collectsAttendeeDetails: false,
      honorsMembership: false,
    },
  });

  const admit = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: ADMIT_KEY } },
    update: { kind: "ADMISSION", priceCents: 2500 },
    create: {
      orgId: org.id,
      key: ADMIT_KEY,
      name: "Verify Admission",
      priceCents: 2500,
      kind: "ADMISSION",
    },
  });
  const merch = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: MERCH_KEY } },
    update: { kind: "MERCH", priceCents: 300 },
    create: {
      orgId: org.id,
      key: MERCH_KEY,
      name: "Verify Sticks",
      priceCents: 300,
      kind: "MERCH",
    },
  });

  await db.serviceCap.create({
    data: { eventId: event.id, serviceTypeId: admit.id, priceCents: 2500, capacity: 40, sold: 3 },
  });
  // Uncapped on purpose: the screen must print a bare count for this one rather
  // than "5 sold of unlimited".
  await db.serviceCap.create({
    data: { eventId: event.id, serviceTypeId: merch.id, priceCents: 300, sold: 5 },
  });

  // ── The paid order: 3 admitted heads, one merch line of qty 5, a donation ──
  const paidOrder = await db.order.create({
    data: {
      orgId: org.id,
      eventId: event.id,
      status: "CONFIRMED",
      method: "STRIPE",
      registrantName: "Asha R",
      registrantEmail: "verify-regs-paid@example.org",
      registrantPhone: "5551234567",
      attendees: {
        // campId set = confirmOrderPaid ran. That is the marker, not the row.
        create: [
          { orgId: org.id, eventId: event.id, campId: `${CODE}-0001` },
          { orgId: org.id, eventId: event.id, campId: `${CODE}-0002` },
          { orgId: org.id, eventId: event.id, campId: `${CODE}-0003` },
        ],
      },
      lineItems: {
        create: [
          {
            orgId: org.id,
            serviceTypeId: admit.id,
            description: "Verify Admission",
            amountCents: 2500,
            quantity: 3,
            status: "PAID",
          },
          {
            orgId: org.id,
            serviceTypeId: merch.id,
            description: "Verify Sticks",
            amountCents: 300,
            quantity: 5,
            status: "PAID",
          },
          {
            orgId: org.id,
            description: "Donation",
            amountCents: 1000,
            quantity: 1,
            isDonation: true,
            status: "PAID",
          },
        ],
      },
      payments: {
        create: [
          // 3×2500 + 5×300 + 1000 = 10000
          { orgId: org.id, method: "STRIPE", status: "SUCCEEDED", amountCents: 10_000 },
          // A dead session on the SAME order. Never money.
          { orgId: org.id, method: "STRIPE", status: "PENDING", amountCents: 10_000 },
        ],
      },
    },
    select: { id: true },
  });

  // ── The abandoned cart: real Attendee rows, no campId, no money ────────────
  await db.order.create({
    data: {
      orgId: org.id,
      eventId: event.id,
      status: "PENDING",
      method: "STRIPE",
      registrantName: "Left Midway",
      registrantEmail: "verify-regs-abandoned@example.org",
      registrantPhone: "5559876543",
      attendees: {
        create: [
          { orgId: org.id, eventId: event.id },
          { orgId: org.id, eventId: event.id },
        ],
      },
      lineItems: {
        create: [
          {
            orgId: org.id,
            serviceTypeId: admit.id,
            description: "Verify Admission",
            amountCents: 2500,
            quantity: 2,
            status: "PENDING_PAYMENT",
          },
        ],
      },
      payments: {
        create: [
          { orgId: org.id, method: "STRIPE", status: "PENDING", amountCents: 5000 },
        ],
      },
    },
  });

  const data = await getEventRegistrations(org.id, event.id);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§1 an abandoned cart is not a registration");
  // 5 Attendee rows exist on this event. Three of them were paid for.
  const rawRows = await db.attendee.count({ where: { eventId: event.id } });
  check("the fixture really does have more rows than registrations", rawRows === 5, `${rawRows} rows`);
  check("registered counts only attendees holding a campId", data.paidAttendees === 3, `${data.paidAttendees}`);
  check("paid orders excludes the PENDING one", data.paidOrders === 1, `${data.paidOrders}`);
  check("the abandoned cart is counted, separately", data.unpaidOrders === 1, `${data.unpaidOrders}`);
  check("…and priced, so the gap is explainable", data.unpaidCents === 5000, `${data.unpaidCents}`);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§2 collected money is SUCCEEDED payments, not Payment rows");
  check("collected is the succeeded payment only", data.collectedCents === 10_000, `${data.collectedCents}`);
  check("one method bucket, not three", data.byMethod.length === 1, `${data.byMethod.length}`);
  check("…and it is STRIPE", data.byMethod[0]?.method === "STRIPE");
  check("the bucket counts one payment, not two", data.byMethod[0]?.count === 1, `${data.byMethod[0]?.count}`);
  check("the dead session on the paid order is not money", data.byMethod[0]?.cents === 10_000);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§3 the summary and the list agree");
  check("one order row is listed", data.orders.length === 1, `${data.orders.length}`);
  check("the listed order is the confirmed one", data.orders[0]?.id === paidOrder.id);
  check(
    "its campIds are the registrations counted above",
    data.orders[0]?.campIds.length === data.paidAttendees,
    `${data.orders[0]?.campIds.length} vs ${data.paidAttendees}`,
  );
  check(
    "list collected sums to the headline figure",
    data.orders.reduce((n, o) => n + o.collectedCents, 0) === data.collectedCents,
  );
  check("the order's settle method is the succeeded one", data.orders[0]?.method === "STRIPE");
  check(
    "unpaid lines are not printed as items on a paid order",
    data.orders[0]?.items.length === 3,
    `${data.orders[0]?.items.length}`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§4 a line total is amountCents × quantity");
  const admitRow = data.offerings.find((o) => o.name === "Verify Admission");
  const merchRow = data.offerings.find((o) => o.name === "Verify Sticks");
  check("admission revenue is 3 × $25", admitRow?.revenueCents === 7500, `${admitRow?.revenueCents}`);
  // The row that catches a bare sum: 5 × $3 is $15, and $3 is the wrong answer.
  check("merch revenue is 5 × $3, not $3", merchRow?.revenueCents === 1500, `${merchRow?.revenueCents}`);
  check("a capped offering carries its ceiling", admitRow?.capacity === 40, `${admitRow?.capacity}`);
  check("an uncapped offering carries null, not 0", merchRow?.capacity === null, `${merchRow?.capacity}`);
  check("sold comes from ServiceCap, not the line items", admitRow?.sold === 3 && merchRow?.sold === 5);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§5 donations and membership are broken out");
  check("the donation is reported", data.donationCents === 1000, `${data.donationCents}`);
  check("no membership was sold, so it is zero", data.membershipCents === 0);
  check(
    "the donation is NOT folded into service revenue",
    (admitRow?.revenueCents ?? 0) + (merchRow?.revenueCents ?? 0) === 9000,
  );
  check(
    "service + donation + membership reconciles to collected",
    (admitRow?.revenueCents ?? 0) +
      (merchRow?.revenueCents ?? 0) +
      data.donationCents +
      data.membershipCents ===
      data.collectedCents,
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§9 purchases per day, on the venue's calendar");
  // The dashboard chart reads the SAME two definitions this file exists to pin,
  // rather than inventing a third. A screen that disagrees with the
  // registrations page about what was collected is worse than either alone.
  const dash = await import("../src/server/dashboard");
  const { venueDayKey } = await import("../src/lib/eventTime");

  const series = await dash.getDailySales(org.id, 7);
  check("one bucket per day, quiet days included", series.length === 7,
    String(series.length));
  // A chart that silently drops empty days compresses its own axis, so a gap in
  // trading reads as activity.
  const expectDays = Array.from({ length: 7 }, (_, i) =>
    venueDayKey(new Date(Date.now() - (6 - i) * 86_400_000)),
  ).join(",");
  check("the buckets are consecutive venue days",
    series.map((d) => d.day).join(",") === expectDays);
  check("every bucket is a YYYY-MM-DD venue day",
    series.every((d) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d.day)));

  // THE VENUE-DAY ROW, and it is deliberately NOT expressed in terms of
  // venueDayKey on both sides -- an earlier version built its expectation with
  // the same function it was testing, so swapping the implementation for
  // toISOString moved both sides together and the row passed a broken build.
  // A fixed instant with a known answer is the only version that can fail.
  //
  // 02:00Z on Oct 11 is 9pm on Oct 10 in Flower Mound (CDT, -5). An evening
  // sale is already tomorrow in UTC, so a UTC key moves the busiest hours of an
  // event onto the next day's bar.
  const eveningSale = new Date("2026-10-11T02:00:00Z");
  check("a 9pm sale buckets on the VENUE's day",
    venueDayKey(eveningSale) === "2026-10-10", venueDayKey(eveningSale));
  check("...and UTC would have put it on the next day",
    eveningSale.toISOString().slice(0, 10) === "2026-10-11");
  check("nothing is negative",
    series.every((d) => d.units >= 0 && d.cents >= 0));

  // THE ROW THAT KEEPS THE TWO SCREENS HONEST. Chart money must be SUCCEEDED
  // payments -- the same rule as collectedCents -- never Payment rows and never
  // order totals. A PENDING payment is a Stripe session somebody opened, which
  // is the same class of mistake as counting an abandoned cart.
  const windowStart = venueDayKey(new Date(Date.now() - 6 * 86_400_000));
  const allPayments = await db.payment.findMany({
    where: { order: { orgId: org.id } },
    select: { amountCents: true, createdAt: true, status: true },
  });
  const inWindow = allPayments.filter(
    (pay) => venueDayKey(pay.createdAt) >= windowStart,
  );
  const expectCents = inWindow
    .filter((pay) => pay.status === "SUCCEEDED")
    .reduce((n, pay) => n + pay.amountCents, 0);
  check("chart money is SUCCEEDED payments, matching the registrations page",
    series.reduce((n, d) => n + d.cents, 0) === expectCents,
    `chart ${series.reduce((n, d) => n + d.cents, 0)} vs ${expectCents}`);
  // ...and the fixture actually contains a non-SUCCEEDED payment, so the row
  // above could fail if the filter were dropped.
  check("there is a non-SUCCEEDED payment in range to get this wrong with",
    inWindow.some((pay) => pay.status !== "SUCCEEDED"));

  // Units are QUANTITIES, not rows: a five-stick line is one row worth five.
  const paidLines = await db.lineItem.findMany({
    where: { status: "PAID", order: { orgId: org.id } },
    select: { quantity: true, isDonation: true },
  });
  check("a quantity>1 line exists, so summing rows would read differently",
    paidLines.some((l) => l.quantity > 1));
  // A donation is money, not a thing anybody bought, so it moves the money bar
  // and must not move the unit bar.
  check("a donation line exists, so excluding it is observable",
    paidLines.some((l) => l.isDonation));
  check("units are a non-negative integer count",
    series.every((d) => Number.isInteger(d.units) && d.units >= 0));

  // THE UNIT ROW. Counted from the same orders the money came from, so the two
  // bars describe one set of purchases: quantity summed, donations dropped.
  const paidInWindow = await db.payment.findMany({
    where: { status: "SUCCEEDED", order: { orgId: org.id } },
    select: { createdAt: true, orderId: true },
    orderBy: { createdAt: "asc" },
  });
  const orderIds = [
    ...new Set(
      paidInWindow
        .filter((pay) => venueDayKey(pay.createdAt) >= windowStart)
        .map((pay) => pay.orderId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const windowLines = await db.lineItem.findMany({
    where: { status: "PAID", orderId: { in: orderIds } },
    select: { quantity: true, isDonation: true },
  });
  const expectUnits = windowLines
    .filter((l) => !l.isDonation)
    .reduce((n, l) => n + l.quantity, 0);
  check("units are PAID quantity with donations excluded",
    series.reduce((n, d) => n + d.units, 0) === expectUnits,
    `chart ${series.reduce((n, d) => n + d.units, 0)} vs ${expectUnits}`);
  // Folding donations in would change the number, which is what makes the
  // exclusion a real rule rather than a comment.
  const withDonations = windowLines.reduce((n, l) => n + l.quantity, 0);
  check("...and counting them would have read differently",
    withDonations !== expectUnits, `${withDonations} vs ${expectUnits}`);

  // CLOSED EVENTS ARE NOT CURRENT TRADE. The chart answers "is anything selling
  // right now", so a camp that finished last week must not keep its bars on it
  // for another fortnight and read as today's business.
  const closedEvent = await db.event.create({
    data: {
      orgId: org.id, type: "GENERAL", status: "CLOSED", code: "VR-CLOSED",
      name: "Finished Event", startsAt: new Date(Date.now() - 3 * 86_400_000),
      endsAt: new Date(Date.now() - 3 * 86_400_000 + 3_600_000),
    },
  });
  const closedOrder = await db.order.create({
    data: {
      orgId: org.id, eventId: closedEvent.id, status: "CONFIRMED", method: "CASH",
      registrantName: "Past Buyer", registrantEmail: "past@example.test",
      registrantPhone: "555-0199",
      lineItems: {
        create: [{
          orgId: org.id, description: "Old ticket",
          amountCents: 4242, quantity: 3, status: "PAID",
        }],
      },
      payments: {
        create: [{
          orgId: org.id, status: "SUCCEEDED", method: "CASH",
          amountCents: 12726, createdAt: new Date(Date.now() - 86_400_000),
        }],
      },
    },
  });

  const afterClose = await dash.getDailySales(org.id, 7);
  check("a CLOSED event's sale is not on the chart",
    afterClose.reduce((n, d) => n + d.cents, 0) === expectCents,
    `${afterClose.reduce((n, d) => n + d.cents, 0)} vs ${expectCents}`);
  check("...nor are its units",
    afterClose.reduce((n, d) => n + d.units, 0) === expectUnits);

  // The same sale on an OPEN event IS current trade — otherwise the row above
  // would pass for an unrelated reason (a filter that excludes everything).
  await db.event.update({
    where: { id: closedEvent.id }, data: { status: "OPEN" },
  });
  const afterOpen = await dash.getDailySales(org.id, 7);
  check("...but the identical sale on an OPEN event IS counted",
    afterOpen.reduce((n, d) => n + d.cents, 0) === expectCents + 12726,
    `${afterOpen.reduce((n, d) => n + d.cents, 0)} vs ${expectCents + 12726}`);
  check("...including its units", 
    afterOpen.reduce((n, d) => n + d.units, 0) === expectUnits + 3);

  // PURGED is a closed event further along the retention path, and money rows
  // outlive the PII purge — so it must be excluded too, not just CLOSED.
  await db.event.update({
    where: { id: closedEvent.id }, data: { status: "PURGED" },
  });
  const afterPurge = await dash.getDailySales(org.id, 7);
  check("a PURGED event is excluded as well",
    afterPurge.reduce((n, d) => n + d.cents, 0) === expectCents);

  await db.payment.deleteMany({ where: { orderId: closedOrder.id } });
  await db.event.delete({ where: { id: closedEvent.id } });


  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§10 the table lists days that sold; the bars list every day");
  // Read AS TEXT, so this asserts what SHIPS rather than a reimplementation
  // that could rot -- same approach as verify:scan §5 and verify:analytics.
  //
  // THE REGRESSION THIS EXISTS FOR: making the bars use `soldDays` too. That
  // reads like a tidy-up and is silent -- the chart still renders, but the
  // x-axis compresses and a gap in trading becomes indistinguishable from
  // activity. The bars must stay on `days`.
  const chartSrc = readFileSync(
    join(process.cwd(), "src/app/_components/DailySalesChart.tsx"),
    "utf8",
  );
  const PREDICATE = /d\.units > 0 \|\| d\.cents > 0/g;

  check("the quiet-day predicate is defined exactly once",
    (chartSrc.match(PREDICATE) ?? []).length === 1,
    String((chartSrc.match(PREDICATE) ?? []).length));
  check("soldDays is that predicate applied to days",
    /const soldDays = days\.filter/.test(chartSrc));
  check("the stat-tile threshold reads off soldDays, not a second filter",
    /const active = soldDays\.length/.test(chartSrc));

  // The table body maps the REVERSED rows...
  check("the table body maps tableRows", chartSrc.includes("{tableRows.map("));
  check("the table body does NOT map days", !chartSrc.includes("{days.map("));
  check("the table body does NOT map soldDays directly",
    !chartSrc.includes("{soldDays.map("));

  // NEWEST FIRST in the table, OLDEST FIRST in the bars. Reversing one without
  // the other would have a reader matching the tallest bar to the wrong row,
  // so both halves are pinned rather than just the one that changed.
  check("tableRows is soldDays reversed, on a copy",
    /const tableRows = \[\.\.\.soldDays\]\.reverse\(\)/.test(chartSrc));
  // .reverse() mutates. Reversing soldDays in place would silently reverse the
  // stat-tile fallback and anything else reading it.
  check("soldDays itself is never reversed in place",
    !/soldDays\.reverse\(\)/.test(chartSrc));

  // ...while BOTH bar charts are still handed the full series.
  const barsEls = chartSrc.match(/<Bars[\s\S]*?\/>/g) ?? [];
  check("there are two Bars elements (units and money)", barsEls.length === 2,
    String(barsEls.length));
  check("every Bars gets days={days}, never soldDays",
    barsEls.every((b) => b.includes("days={days}") && !b.includes("soldDays")));

  // The bucket builder must keep emitting quiet days, or the filter above has
  // nothing to filter and the axis is already compressed upstream.
  const dashSrc = readFileSync(
    join(process.cwd(), "src/server/dashboard.ts"),
    "utf8",
  );
  check("getDailySales still seeds a bucket for EVERY day in range",
    dashSrc.includes("for (let i = days - 1; i >= 0; i--)"));
  const quiet = series.filter((d) => d.units === 0 && d.cents === 0);
  check("the live series really does contain a quiet day to drop",
    quiet.length > 0, quiet.length + " quiet of " + series.length);
  check("...and at least one day that sold, so the table is not empty",
    series.some((d) => d.units > 0 || d.cents > 0));



  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§10 the platform service fee is broken out of the organisation's revenue");
  // A buyer-paid fee line and a fee-cover line are PAID lines on a confirmed
  // order, so a naive sum folds the platform's money into service revenue and
  // a naive unit count sells two phantom tickets. Each gets a bucket of its
  // own; "collected" stays what the card was charged, because that is what a
  // coordinator reconciles against Stripe.
  await db.event.update({ where: { id: event.id }, data: { status: "OPEN" } });
  const before = await getEventRegistrations(org.id, event.id);
  const seriesBefore = await dash.getDailySales(org.id, 7);
  const unitsOf = (s: { units: number }[]) => s.reduce((n, d) => n + d.units, 0);
  await db.order.create({
    data: {
      orgId: org.id,
      eventId: event.id,
      status: "CONFIRMED",
      method: "STRIPE",
      registrantName: "Fee Payer",
      registrantEmail: "verify-regs-fee@example.org",
      registrantPhone: "5550001111",
      coverProcessingFee: true,
      attendees: { create: [{ orgId: org.id, eventId: event.id, campId: `${CODE}-0004` }] },
      lineItems: {
        create: [
          { orgId: org.id, serviceTypeId: admit.id, description: "Verify Admission", amountCents: 2500, quantity: 1, status: "PAID" },
          { orgId: org.id, description: "Service fee", amountCents: 87, quantity: 1, feeKind: "PLATFORM_FEE", status: "PAID" },
          { orgId: org.id, description: "$1.09 to cover the payment-processing cost for Verify", amountCents: 109, quantity: 1, feeKind: "FEE_COVER", status: "PAID" },
        ],
      },
      // 2500 + 87 + 109
      payments: { create: [{ orgId: org.id, method: "STRIPE", status: "SUCCEEDED", amountCents: 2696, applicationFeeCents: 87 }] },
    },
  });
  const after = await getEventRegistrations(org.id, event.id);
  const seriesAfter = await dash.getDailySales(org.id, 7);
  const admitAfter = after.offerings.find((o) => o.name === "Verify Admission");
  check("the platform fee is reported in its own bucket", after.platformFeeCents === 87, `${after.platformFeeCents}`);
  check("the fee cover is reported in its own bucket", after.feeCoverCents === 109, `${after.feeCoverCents}`);
  check("neither is folded into service revenue: admission rose by exactly one $25 seat",
    (admitAfter?.revenueCents ?? 0) === (admitRow?.revenueCents ?? 0) + 2500, `${admitAfter?.revenueCents}`);
  check("collected rose by the whole charge, fee included — it is what the card was charged",
    after.collectedCents === before.collectedCents + 2696, `${after.collectedCents}`);
  check("service + donation + membership + fee + cover reconciles to collected",
    after.offerings.reduce((n, o) => n + o.revenueCents, 0)
      + after.donationCents + after.membershipCents
      + after.platformFeeCents + after.feeCoverCents === after.collectedCents);
  check("fee lines are not units on the chart: one seat, not three",
    unitsOf(seriesAfter) === unitsOf(seriesBefore) + 1,
    `${unitsOf(seriesAfter) - unitsOf(seriesBefore)}`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§11 named entrants: a doubles entry is two named heads on one line, with a fair-market-value snapshot");
  // A tournament sells a DOUBLES entry: one line, two heads, and the organiser
  // needs both names and who is playing with whom. The heads are minted per
  // line with a seat index, so a partner is "the other seat in the same unit"
  // — no pairing table, no second form. A dinner offering carries the fair
  // market value of what the guest receives; it is snapshotted onto the line
  // at creation so a receipt re-issued next year reads the value that applied
  // when they paid, never today's.
  const { createRegistration } = await import("../src/server/registration");
  const { confirmOrderPaid } = await import("../src/server/payments");
  const { getEntrantRows, ENTRANTS_REPORT_HEADER } = await import("../src/server/entrants");
  const { contributionOf } = await import("../src/lib/contribution");
  const doubles = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: DOUBLES_KEY } },
    update: { kind: "ADMISSION", priceCents: 25000, admitsCount: 2 },
    create: { orgId: org.id, key: DOUBLES_KEY, name: "Verify Doubles", priceCents: 25000, kind: "ADMISSION", admitsCount: 2 },
  });
  await db.serviceCap.create({
    data: { eventId: event.id, serviceTypeId: doubles.id, priceCents: 25000, capacity: 20, fairMarketValueCents: 7500 },
  });
  await db.event.update({ where: { id: event.id }, data: { namesAttendees: true } });
  const buyer = { name: "Doubles Buyer", email: "verify-regs-doubles@example.org", phone: "5550002222" };
  const attempt = (q: { quantity: number; names?: string[] }) =>
    createRegistration({ eventId: event.id, registrant: buyer, marketingConsent: false, quantities: [{ serviceKey: DOUBLES_KEY, ...q }] })
      .then(() => "accepted", (e: Error) => e.message);
  const NEED = "Enter a name for each entrant — Verify Doubles needs ";
  check("with the flag on, an entry without names is refused, saying how many",
    (await attempt({ quantity: 1 })) === NEED + "2.", await attempt({ quantity: 1 }));
  check("...and too few names is the same refusal (two units need four)",
    (await attempt({ quantity: 2, names: ["Asha", "Ravi", "Meera"] })) === NEED + "4.");
  check("...and a blank name is refused by the schema",
    (await attempt({ quantity: 1, names: ["Asha", "   "] })).includes("Every entrant needs a name"));

  const entry = await createRegistration({
    eventId: event.id, registrant: buyer, marketingConsent: false,
    quantities: [{ serviceKey: DOUBLES_KEY, quantity: 2, names: [" Asha ", "Ravi", "Meera", "Dev"] }],
  });
  const heads = await db.attendee.findMany({ where: { orderId: entry.orderId }, orderBy: { seat: "asc" } });
  check("two units × two heads mint four named attendees, seats 0–3, names trimmed",
    heads.map((h) => `${h.seat}:${h.name}`).join("|") === "0:Asha|1:Ravi|2:Meera|3:Dev",
    heads.map((h) => `${h.seat}:${h.name}`).join("|"));
  const line = await db.lineItem.findFirstOrThrow({ where: { orderId: entry.orderId, serviceTypeId: doubles.id } });
  check("...every head points at the line that minted it", heads.every((h) => h.lineItemId === line.id));
  check("the line carries the fair-market-value snapshot", line.fairMarketValueCents === 7500, String(line.fairMarketValueCents));
  check("...and the FMV never changes the price", line.amountCents === 25000);
  await db.serviceCap.update({
    where: { eventId_serviceTypeId: { eventId: event.id, serviceTypeId: doubles.id } },
    data: { fairMarketValueCents: 9900 },
  });
  check("a later change to the offering's FMV does not touch the line",
    (await db.lineItem.findUniqueOrThrow({ where: { id: line.id } })).fairMarketValueCents === 7500);
  check("contributionOf: paid, value received and the deductible limit, × quantity",
    JSON.stringify(contributionOf([line])) === JSON.stringify({ paidCents: 50000, fairMarketValueCents: 15000, deductibleCents: 35000 }),
    JSON.stringify(contributionOf([line])));
  check("...nothing to say when no line carries an FMV",
    contributionOf([{ amountCents: 2500, quantity: 1, fairMarketValueCents: null }]) === null);
  check("...a ticket worth more than it cost deducts nothing, never a negative",
    contributionOf([{ amountCents: 1000, quantity: 1, fairMarketValueCents: 2500 }])?.deductibleCents === 0);
  check("...and the platform's fee line is not a contribution",
    contributionOf([line, { amountCents: 109, quantity: 1, fairMarketValueCents: null, feeKind: "PLATFORM_FEE" }])?.paidCents === 50000);

  await confirmOrderPaid(entry.orderId, { method: "ZELLE", idempotencyKey: `verify-regs-doubles-${entry.orderId}` });
  const rows = await getEntrantRows(org.id, event.id);
  check("the entrants report lists one row per player", rows.length === 4, String(rows.length));
  check("...partners are paired by seat within the line",
    rows.find((r) => r.player === "Asha")?.partner === "Ravi" && rows.find((r) => r.player === "Dev")?.partner === "Meera",
    rows.map((r) => `${r.player}+${r.partner}`).join(","));
  check("...under the division — the offering's name", rows.every((r) => r.division === "Verify Doubles"));
  check("...with the order, the buyer's email and when it was paid",
    rows.every((r) => r.order === entry.orderId && r.email === buyer.email && r.paid_at !== ""));
  check("...and the CSV header is exactly these columns",
    ENTRANTS_REPORT_HEADER.join(",") === "division,player,partner,order,email,paid_at");
  const listed = (await getEventRegistrations(org.id, event.id)).orders.find((o) => o.id === entry.orderId);
  check("the registrations page lists the names beside the codes",
    listed?.heads.map((h) => h.name).join(",") === "Asha,Ravi,Meera,Dev" && listed.heads.every((h) => h.campId !== null),
    listed?.heads.map((h) => `${h.name}/${h.campId}`).join(","));

  await db.event.update({ where: { id: event.id }, data: { namesAttendees: false } });
  const unnamed = await createRegistration({
    eventId: event.id, registrant: buyer, marketingConsent: false,
    quantities: [{ serviceKey: DOUBLES_KEY, quantity: 1, names: ["X", "Y"] }],
  });
  check("with the flag off, names sent anyway are NOT stored — the event did not ask (No-PHI)",
    (await db.attendee.findMany({ where: { orderId: unnamed.orderId } })).every((a) => a.name === null));
  check("...but the heads still carry their line and seat",
    (await db.attendee.findMany({ where: { orderId: unnamed.orderId }, orderBy: { seat: "asc" } })).map((a) => a.seat).join(",") === "0,1");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§12 a donation is an order with no event: it confirms, it is counted, receipted and listed");
  // The donate page sells nothing and admits nobody. Its order has no event
  // (the organisation's general fund), one donation line, no heads, and it
  // goes through the same confirmation as a ticket — the money chart must
  // count it, the donor list must show it beside the donations made on a
  // ticket order, and a receipt (not a ticket) is what gets emailed.
  const { createDonationOrder, getDonorRows, DONORS_REPORT_HEADER } = await import("../src/server/donations");
  const { resolveOrgDonations } = await import("../src/lib/orgSettings");
  check("donations are off until the organisation turns them on", resolveOrgDonations({}).enabled === false);
  check("...and a stored policy round-trips, defaults filled",
    JSON.stringify(resolveOrgDonations({ donations: { enabled: true, suggestedAmountsCents: [2500, 5000], minCents: 500 } }))
      === JSON.stringify({ enabled: true, suggestedAmountsCents: [2500, 5000], allowFeeCover: true, minCents: 500 }));
  const donor = { name: "Giver", email: "verify-regs-donor@example.org" };
  const gift = await createDonationOrder(org.id, {
    donor, amountCents: 2500, coverFee: false, honoreeName: "Grandma", donorNote: "In memory", marketingConsent: false,
  }, { enabled: true, suggestedAmountsCents: [2500], allowFeeCover: true, minCents: 100 });
  const giftOrder = await db.order.findUniqueOrThrow({ where: { id: gift.orderId }, include: { lineItems: true, attendees: true } });
  check("an eventless order with ONE donation line and no heads",
    giftOrder.eventId === null && giftOrder.lineItems.length === 1 && giftOrder.lineItems[0]?.isDonation === true && giftOrder.attendees.length === 0,
    `event ${giftOrder.eventId} lines ${giftOrder.lineItems.length} heads ${giftOrder.attendees.length}`);
  check("...carrying the honoree and the note", giftOrder.honoreeName === "Grandma" && giftOrder.donorNote === "In memory");
  check("...worth exactly the gift", gift.totalCents === 2500 && giftOrder.lineItems[0]?.amountCents === 2500);
  const centsOf = (s: { cents: number }[]) => s.reduce((n, d) => n + d.cents, 0);
  const seriesBeforeGift = await dash.getDailySales(org.id, 7);
  await confirmOrderPaid(gift.orderId, { method: "ZELLE", idempotencyKey: `verify-regs-gift-${gift.orderId}` });
  check("it confirms with no event, no ticket and no capacity to claim",
    (await db.order.findUniqueOrThrow({ where: { id: gift.orderId } })).status === "CONFIRMED");
  const seriesAfterGift = await dash.getDailySales(org.id, 7);
  check("the sales chart counts the money (the eventless arm) and no units",
    centsOf(seriesAfterGift) === centsOf(seriesBeforeGift) + 2500 && unitsOf(seriesAfterGift) === unitsOf(seriesBeforeGift),
    `+${centsOf(seriesAfterGift) - centsOf(seriesBeforeGift)} cents, +${unitsOf(seriesAfterGift) - unitsOf(seriesBeforeGift)} units`);
  // A second gift, left unpaid: a donor list is money received, never intent.
  const unpaidGift = await createDonationOrder(org.id, { donor, amountCents: 9900, coverFee: false, marketingConsent: false },
    { enabled: true, suggestedAmountsCents: [2500], allowFeeCover: true, minCents: 100 });
  const donors = await getDonorRows(org.id, { year: new Date().getFullYear() });
  check("the donor list has the general-fund gift as 'general'",
    donors.some((r) => r.order === gift.orderId && r.event === "general" && r.amount_usd === "25.00" && r.donor === "Giver" && r.honoree === "Grandma"),
    JSON.stringify(donors.find((r) => r.order === gift.orderId)));
  check("...and the donation made on the paid ticket order, under its event code",
    donors.some((r) => r.order === paidOrder.id && r.event === CODE && r.amount_usd === "10.00"));
  check("...and not the unpaid gift", !donors.some((r) => r.order === unpaidGift.orderId));
  check("...with the header exactly these columns", DONORS_REPORT_HEADER.join(",") === "date,donor,email,amount_usd,event,honoree,order");
  check("...and nothing from another year", (await getDonorRows(org.id, { year: 1999 })).length === 0);
  // THE YEAR IS THE VENUE'S. 11:30pm on New Year's Eve in Flower Mound is
  // 05:30 UTC on 1 January: a UTC year would move that gift into the new
  // year's list, and a year-end letter would thank the donor for a gift they
  // made last year. Not expressed via venueDayKey on both sides — a fixed
  // instant with a known answer is the only version that can fail.
  await db.order.create({
    data: {
      orgId: org.id, eventId: null, status: "CONFIRMED", method: "STRIPE",
      registrantName: "Midnight Giver", registrantEmail: "verify-regs-donor@example.org", registrantPhone: "",
      lineItems: { create: [{ orgId: org.id, description: "Donation", amountCents: 1500, quantity: 1, isDonation: true, status: "PAID" }] },
      payments: { create: [{ orgId: org.id, method: "STRIPE", status: "SUCCEEDED", amountCents: 1500, createdAt: new Date("2026-01-01T05:30:00Z") }] },
    },
  });
  const in2026 = await getDonorRows(org.id, { year: 2026 });
  const in2025 = await getDonorRows(org.id, { year: 2025 });
  check("a gift at 11:30pm on New Year's Eve, venue time, belongs to the old year",
    !in2026.some((r) => r.donor === "Midnight Giver") && in2025.some((r) => r.donor === "Midnight Giver" && r.date === "2025-12-31"),
    `2026: ${in2026.filter((r) => r.donor === "Midnight Giver").length}, 2025: ${in2025.filter((r) => r.donor === "Midnight Giver").map((r) => r.date).join(",")}`);
  // The receipt path, read as text: an eventless order gets a receipt, never
  // a ticket email, from the one block that sends both.
  const paySrc = readFileSync(join(process.cwd(), "src/server/payments.ts"), "utf8");
  check("confirmOrderPaid sends a donation receipt for an eventless order", /sendDonationReceiptEmail\(/.test(paySrc));
  check("...and stamps receiptSentAt only when it was delivered", /receiptSentAt/.test(paySrc) && /delivered/.test(paySrc));

  await cleanup(org.id);
}

async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({ where: { orgId, code: CODE } });
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
    await db.ledgerEntry.deleteMany({
      where: { paymentId: { in: payments.map((p) => p.id) } },
    });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    // Event delete cascades orders, attendees, line items and service caps.
    await db.event.delete({ where: { id: event.id } });
  }
  await db.serviceType.deleteMany({
    where: { orgId, key: { in: [ADMIT_KEY, MERCH_KEY, DOUBLES_KEY] } },
  });
  // Eventless (general-fund) orders are not under any event's cascade.
  const gifts = await db.order.findMany({
    where: { orgId, eventId: null, registrantEmail: "verify-regs-donor@example.org" },
    select: { id: true },
  });
  const giftIds = gifts.map((g) => g.id);
  const giftPayments = await db.payment.findMany({ where: { orderId: { in: giftIds } }, select: { id: true } });
  await db.ledgerEntry.deleteMany({ where: { paymentId: { in: giftPayments.map((p) => p.id) } } });
  await db.payment.deleteMany({ where: { orderId: { in: giftIds } } });
  await db.order.deleteMany({ where: { id: { in: giftIds } } });
}

main()
  .then(async () => {
    await db.$disconnect();
    console.log(
      failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
