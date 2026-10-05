/**
 * Mint one order per DOOR SCENARIO, all to a single tester.
 *
 *   ENV_FILE=<composed> npx tsx scripts/mint-scenarios.ts you@example.com
 *   ENV_FILE=<composed> npx tsx scripts/mint-scenarios.ts you@example.com --send
 *
 * WHY THIS EXISTS. scripts/setup-rehearsal.ts gives twelve people one ticket
 * each — enough to rehearse a queue, useless for exercising the verdict
 * table. This gives ONE person a ticket for every branch the door can take,
 * so a single tester can walk the whole state machine alone: admitted,
 * already in, partly in, party, merch pickup, not-a-ticket, unpaid will-call,
 * refunded, cancelled.
 *
 * ORDERS, NOT ROWS. Everything goes through createRegistration() and
 * confirmOrderPaid(), exactly as the card path does, so these reconcile like
 * real sales. The only hand-written state is the END state a scenario needs
 * and the app has no action for — REFUNDED and CANCELLED have no UI anywhere
 * (refunds happen in the Stripe dashboard), and "already admitted" is a
 * checkedInAt stamp. Those are set after a normal confirmation, never
 * instead of one.
 *
 * NOT IN THE VERIFY CHAIN — it writes to a live database and sends mail.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const positional = args.filter((a) => !a.startsWith("--"));
const EMAIL = positional[0];
/**
 * The registrant name, and it is NOT cosmetic. DANDIYA-2026 sets
 * `collectsAttendeeDetails = false`, so every attendee row is nameless and
 * `searchGateGuests` can only match `order.registrantName`. This string is
 * the only thing the door can search for. It was hard-coded to one tester
 * once, which would have filed a second tester's whole scenario set under
 * the wrong person.
 */
const NAME = positional[1];

const EVENT_CODE = "DANDIYA-2026";
const PHONE = "000-000-0000";

const ENTRY = "floor-admission";
const STICKS = "dandiya-sticks";
const FAMILY4 = "dandiya-family-4";
const TENPACK = "dandiya-10-pack";

type Item = { serviceKey: string; quantity: number };

/**
 * `end` is what to do AFTER a clean confirmation, to put the order in the
 * state the scenario is about.
 *   paid     — leave it confirmed (the happy path)
 *   admitted — stamp every ticket in     → ALREADY IN, amber
 *   partial  — stamp SOME tickets in     → PARTLY IN, amber with an action
 *   unpaid   — do not confirm at all     → no campId; findable by SEARCH only
 *   refunded — confirm, then REFUNDED    → red, unsettleable
 *   cancelled— confirm, then CANCELLED   → red, unsettleable
 */
type End = "paid" | "admitted" | "partial" | "unpaid" | "refunded" | "cancelled";

const SCENARIOS: {
  tag: string;
  items: Item[];
  end: End;
  expect: string;
}[] = [
  { tag: "plain paid entry", items: [{ serviceKey: ENTRY, quantity: 1 }],
    end: "paid", expect: "green ADMITTED · Give wristband" },
  { tag: "paid + pre-bought sticks",
    items: [{ serviceKey: ENTRY, quantity: 1 }, { serviceKey: STICKS, quantity: 2 }],
    end: "paid", expect: "green ADMITTED, then Pre-bought — hand over" },
  { tag: "family of 4", items: [{ serviceKey: FAMILY4, quantity: 1 }],
    end: "paid", expect: "4 pips, Admit all 4" },
  { tag: "family of 4, half already in", items: [{ serviceKey: FAMILY4, quantity: 1 }],
    end: "partial", expect: "amber PARTLY IN · Admit remaining 2" },
  { tag: "already admitted", items: [{ serviceKey: ENTRY, quantity: 1 }],
    end: "admitted", expect: "amber ALREADY IN with the original time" },
  { tag: "unpaid will-call (no code)", items: [{ serviceKey: ENTRY, quantity: 1 }],
    end: "unpaid", expect: "no QR — find by name, then Take cash & admit" },
  { tag: "refunded", items: [{ serviceKey: ENTRY, quantity: 1 }],
    end: "refunded", expect: "red REFUNDED · no settle control at any price" },
  { tag: "cancelled", items: [{ serviceKey: ENTRY, quantity: 1 }],
    end: "cancelled", expect: "red CANCELLED · not valid for entry" },
  // KNOWN DEFECT, kept in the set because it is the point of the scenario.
  // `ticketCount = admissionUnits > 0 ? admissionUnits : 1` gives a merch-only
  // order one code on purpose — "a receipt, not an admission". But getGateView
  // reports isPaid:true, so the door shows GREEN "Admit & wristband"; only the
  // tap fails, because admitAttendee throws NOT_A_TICKET on admitsNobody().
  // The server refuses, so nobody gets in free — but the volunteer has already
  // told them they are in. Verified against the deployed server 2026-09-28.
  { tag: "merch only — receipt, not a ticket", items: [{ serviceKey: STICKS, quantity: 2 }],
    end: "paid",
    expect: "BUG: shows green ADMITTED; only the tap fails with NOT A TICKET" },
  { tag: "package of 10", items: [{ serviceKey: TENPACK, quantity: 1 }],
    end: "paid", expect: "10 nameless pips, Admit all 10" },
];

async function main(): Promise<void> {
  const { env } = await import("../src/lib/env");
  const { db } = await import("../src/lib/db");
  const { createRegistration } = await import("../src/server/registration");
  const { confirmOrderPaid } = await import("../src/server/payments");

  if (!EMAIL || !EMAIL.includes("@") || !NAME) {
    console.error(
      '\nUsage: mint-scenarios.ts <email> "<Registrant Name>" [--send]\n',
    );
    process.exit(1);
  }

  const event = await db.event.findFirstOrThrow({
    where: { code: EVENT_CODE },
    include: { caps: { include: { serviceType: true } } },
  });
  const price = new Map(event.caps.map((c) => [c.serviceType.key, c.priceCents]));
  const cap = new Map(
    event.caps.map((c) => [
      c.serviceType.key,
      c.capacity === null ? Infinity : c.capacity - c.sold,
    ]),
  );

  console.log(`\n  event    ${event.code} (${event.status})`);
  console.log(`  tester   ${NAME} <${EMAIL}>`);
  console.log(`  app url  ${env.NEXT_PUBLIC_APP_URL}`);
  console.log(`  email    ${SEND ? `WILL SEND via ${env.EMAIL_PROVIDER}` : "not sending (no --send)"}\n`);

  // Headroom first: a scenario that dies on OverCapacity halfway through
  // leaves the tester with a partial set and no obvious sign which is missing.
  const need = new Map<string, number>();
  for (const s of SCENARIOS)
    for (const it of s.items)
      need.set(it.serviceKey, (need.get(it.serviceKey) ?? 0) + it.quantity);
  let blocked = false;
  for (const [key, n] of need) {
    const left = cap.get(key);
    if (left === undefined) {
      console.log(`  MISSING  ${key} is not offered at this event`);
      blocked = true;
    } else if (left < n) {
      console.log(`  NO ROOM  ${key}: need ${n}, ${left} left`);
      blocked = true;
    } else {
      console.log(`  ok       ${key}: need ${n}, ${left === Infinity ? "unlimited" : left} left`);
    }
  }
  if (blocked) {
    console.error("\nRefusing to start — raise the cap or drop a scenario.\n");
    process.exit(1);
  }

  console.log(`\n  ${SCENARIOS.length} scenarios:`);
  for (const s of SCENARIOS) {
    const total = s.items.reduce(
      (n, it) => n + (price.get(it.serviceKey) ?? 0) * it.quantity, 0);
    console.log(`    ${s.tag.padEnd(30)} $${(total / 100).toFixed(2).padStart(7)}  ${s.expect}`);
  }

  if (!SEND) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --send.\n`);
    await db.$disconnect();
    return;
  }

  console.log(`\n  minting:`);
  const pack: { tag: string; expect: string; codes: string[]; note: string }[] = [];

  for (const s of SCENARIOS) {
    try {
      const created = await createRegistration({
        eventId: event.id,
        registrant: { name: NAME, email: EMAIL, phone: PHONE },
        marketingConsent: false,
        quantities: s.items,
      });

      if (s.end === "unpaid") {
        // Left PENDING on purpose: no confirmation, so no campId is ever
        // assigned and there is nothing to scan. That IS the scenario —
        // a will-call guest the door can only reach through search.
        pack.push({ tag: s.tag, expect: s.expect, codes: [],
          note: "PENDING — search by registrant name" });
        console.log(`    ok  ${s.tag.padEnd(30)} left PENDING (no code)`);
        continue;
      }

      const res = await confirmOrderPaid(created.orderId, {
        method: "CASH",
        idempotencyKey: `scenario-${created.orderId}`,
      });

      let note = "";
      if (s.end === "admitted" || s.end === "partial") {
        const atts = await db.attendee.findMany({
          where: { orderId: created.orderId },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        const take = s.end === "admitted" ? atts.length : Math.floor(atts.length / 2);
        await db.attendee.updateMany({
          where: { id: { in: atts.slice(0, take).map((a) => a.id) } },
          data: { checkedInAt: new Date() },
        });
        note = `${take} of ${atts.length} pre-admitted`;
      }
      if (s.end === "refunded" || s.end === "cancelled") {
        const status = s.end === "refunded" ? "REFUNDED" : "CANCELLED";
        await db.$transaction([
          db.order.update({ where: { id: created.orderId }, data: { status } }),
          db.lineItem.updateMany({
            where: { orderId: created.orderId },
            data: { status: s.end === "refunded" ? "REFUNDED" : "VOID" },
          }),
          db.payment.updateMany({
            where: { orderId: created.orderId },
            data: { status: "REFUNDED" },
          }),
        ]);
        note = `order set ${status}`;
      }

      pack.push({ tag: s.tag, expect: s.expect, codes: res.campIds, note });
      console.log(
        `    ok  ${s.tag.padEnd(30)} ${res.campIds.length} code(s)${note ? "  " + note : ""}`,
      );
    } catch (e) {
      console.log(`    FAIL ${s.tag.padEnd(29)} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n  ── WHAT EACH CODE SHOULD DO ────────────────────────────`);
  for (const p of pack) {
    console.log(`\n  ${p.tag}${p.note ? `  (${p.note})` : ""}`);
    console.log(`    expect: ${p.expect}`);
    if (p.codes.length === 0) console.log(`    (no code — this one is search-only)`);
    for (const c of p.codes) console.log(`    ${c}   ${env.NEXT_PUBLIC_APP_URL}/t/${c}`);
  }
  console.log("");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
