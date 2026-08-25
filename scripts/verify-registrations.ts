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

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { getEventRegistrations } = await import("../src/server/registrations");

  const org = await db.organization.findFirstOrThrow();
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
    where: { orgId, key: { in: [ADMIT_KEY, MERCH_KEY] } },
  });
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
