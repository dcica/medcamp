/**
 * Stand up the day-of rehearsal on the TEST copy of Dandiya Night.
 *
 *   ENV_FILE=<composed> npx tsx scripts/setup-rehearsal.ts            # dry run
 *   ENV_FILE=<composed> npx tsx scripts/setup-rehearsal.ts --commit   # no email
 *   ENV_FILE=<composed> npx tsx scripts/setup-rehearsal.ts --commit --send
 *
 * Runbook: docs/Rehearsal-Day-Of.md
 *
 * WHY A SCRIPT AND NOT THE ADMIN UI. `/scan` refuses to open unless FOUR things
 * hold at once (`getScanStationEvent`, src/server/events.ts): the event is
 * ACTIVE, `startsAt <= now <= endsAt`, `endsAt >= now`, and the org resolves.
 * Dandiya is OPEN and starts 2026-10-11. Getting all four right by hand, with
 * eight people already in the room, is the wrong way to begin a rehearsal.
 *
 * NEVER HAND-WRITTEN ROWS. Every order goes through `createRegistration()` then
 * `confirmOrderPaid()` — the same two functions the card path and
 * `scripts/mint-offline-order.ts` funnel through. So a rehearsal order reaches
 * reconciliation identically to a real one: atomic cap decrement, campId per
 * admission unit, line items PAID, Payment{SUCCEEDED}, LedgerEntry{CREDIT}, and
 * the genuine confirmation email with one inline QR per ticket. The manifest
 * below cannot set a price; it can only be wrong about one, and the cap row is
 * the authority.
 *
 * THIS SENDS REAL EMAIL TO REAL PEOPLE. That is the whole point — an organizer
 * needs a real QR to scan and to print — but it is also why minting sits behind
 * `--send` and why the default output is a dry run naming every recipient.
 *
 * NOT IN THE VERIFY CHAIN. It writes to a live database and sends mail.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const COMMIT = process.argv.includes("--commit");
const SEND = process.argv.includes("--send");

const EVENT_CODE = "DANDIYA-2026";

/** Doors "opened" half an hour ago, and we have six hours of rehearsal. */
const DOORS_OPENED_MINUTES_AGO = 30;
const RUNS_FOR_HOURS = 6;

/**
 * What the email and every /t/ page say, so nobody mistakes a rehearsal ticket
 * for an Oct 11 ticket. `location` is rendered in the email's "Where and when"
 * block AND on the wallet page, which is why the warning goes there rather
 * than only in the name.
 */
const REHEARSAL_NAME = "Dandiya Night — REHEARSAL (not the real event)";
const REHEARSAL_LOCATION =
  "REHEARSAL ONLY — admits you to nothing. Test plan sent separately.";

const ENTRY = "floor-admission";
const STICKS = "dandiya-sticks";
const FAMILY4 = "dandiya-family-4";
const TENPACK = "dandiya-10-pack";

/**
 * The roster. Names matter more than usual here: Dandiya has
 * `collectsAttendeeDetails = false`, so every attendee is nameless and
 * `searchGateGuests` can only match the REGISTRANT — these strings are the
 * only searchable names at the door.
 */
type Entry = {
  name: string;
  email: string;
  items: { serviceKey: string; quantity: number }[];
  note: string;
};

const ROSTER: Entry[] = [
  { name: "Sachin Jain", email: "thejain@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }, { serviceKey: STICKS, quantity: 2 }],
    note: "entry + pre-bought sticks" },
  { name: "Srini Hanmandlu", email: "shanmandlu@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  { name: "Manish Popli", email: "popli.manish@gmail.com",
    items: [{ serviceKey: FAMILY4, quantity: 1 }], note: "FAMILY OF 4 — party admit" },
  { name: "Anurag Sharma", email: "anuragksharma@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }, { serviceKey: STICKS, quantity: 2 }],
    note: "entry + pre-bought sticks" },
  { name: "Narendra Gupta", email: "gupta.narendra@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  { name: "Naresh Garg", email: "naresh.garg@gmail.com",
    items: [{ serviceKey: TENPACK, quantity: 1 }],
    note: "PACKAGE OF 10 — ten nameless rows, the Oct 11 worst case" },
  { name: "Gagan Pandey", email: "gaganpandey1977@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  { name: "Avneesh Chhabra", email: "avneesh28@gmail.com",
    items: [{ serviceKey: FAMILY4, quantity: 1 }], note: "FAMILY OF 4 — party admit" },
  { name: "Bala", email: "balasg@yahoo.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }, { serviceKey: STICKS, quantity: 2 }],
    note: "entry + pre-bought sticks" },
  { name: "Sanjay Gupta", email: "guptamgs@hotmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  { name: "Sirish", email: "sirishm@yahoo.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  { name: "Madhu Rana", email: "ranamadhu@gmail.com",
    items: [{ serviceKey: ENTRY, quantity: 1 }], note: "entry" },
  // Added 2026-09-27. A coordinator needs more than one code to exercise the
  // screens she is supposed to oversee, so she gets a party AND merch: four
  // scannable tickets for party admit, and sticks for the hand-over path.
  { name: "Archana Jain", email: "archanajain@gmail.com",
    items: [{ serviceKey: FAMILY4, quantity: 1 }, { serviceKey: STICKS, quantity: 2 }],
    note: "COORDINATOR — family of 4 + sticks" },
];

/** A visible sentinel beats inventing a plausible number. */
const ROSTER_PHONE = "000-000-0000";

/**
 * Rehearsal volunteers. `.invalid` is an RFC-2606 reserved TLD and
 * `isUndeliverableAddress` skips it, so creating these sends no mail — unlike
 * the roster above, where the email IS the ticket.
 */
const VOLUNTEERS = [
  { name: "Rehearsal Volunteer One", email: "vol1@rehearsal.invalid", role: "Greeter / Usher" },
  { name: "Rehearsal Volunteer Two", email: "vol2@rehearsal.invalid", role: "Greeter / Usher" },
  { name: "Rehearsal Volunteer Three", email: "vol3@rehearsal.invalid", role: "Registration / Ticket Desk" },
  { name: "Rehearsal Volunteer Four", email: "vol4@rehearsal.invalid", role: "Food Stall Helper" },
];

/** Round 7 needs a refunded ticket, and the app has no refund action at all. */
const REFUND_FIXTURE = {
  name: "Rehearsal Refunded Buyer",
  email: "refunded@rehearsal.invalid",
};

/** The sold-out drill needs a cap small enough to exhaust in one round. */
const TENPACK_REHEARSAL_CAP = 2;

/**
 * Staff who sign in with their real Google account rather than /test-login.
 *
 * A pending `Invite` row is the product's own mechanism: `events.signIn` in
 * src/lib/auth.ts grants the membership from the invite on first sign-in and
 * stamps `acceptedAt`. Used in preference to BOOTSTRAP_ADMIN_EMAILS because
 * that is an env var and would need a redeploy, and because an invite records
 * the capability flags (`canHoldTill`) that the env path hard-codes.
 *
 * Idempotent: an already-accepted invite is left alone rather than reset,
 * since re-offering an accepted invite to someone who already has a
 * membership does nothing anyway.
 */
const STAFF_INVITES: {
  email: string;
  role: "COORDINATOR";
  canHoldTill: boolean;
}[] = [
  { email: "archanajain@gmail.com", role: "COORDINATOR", canHoldTill: true },
  { email: "gaganpandey1977@gmail.com", role: "COORDINATOR", canHoldTill: true },
];

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main(): Promise<void> {
  // Imported late, exactly as mint-offline-order.ts does, so nothing
  // constructs Prisma or validates env before dotenv has run.
  const { env } = await import("../src/lib/env");
  const { db } = await import("../src/lib/db");
  const { getSesAccountStatus } = await import("../src/lib/email");
  const { createRegistration } = await import("../src/server/registration");
  const { confirmOrderPaid } = await import("../src/server/payments");

  console.log(`\n  mode            ${SEND ? "COMMIT + SEND EMAIL" : COMMIT ? "COMMIT (no email)" : "DRY RUN"}`);
  console.log(`  env file        ${process.env.ENV_FILE ?? ".env"}`);
  console.log(`  app url         ${env.NEXT_PUBLIC_APP_URL}`);
  console.log(`  email provider  ${env.EMAIL_PROVIDER} (from: ${env.EMAIL_FROM ?? "unset"})`);

  // ── Send-path preflight ─────────────────────────────────────────────────
  // Every one of these failures is SILENT at run time: confirmOrderPaid's
  // dispatch() swallows provider errors by design, so a misconfigured send
  // confirms twelve orders and delivers nothing, with no red anywhere.
  if (SEND) {
    if (env.NEXT_PUBLIC_APP_URL.includes("localhost")) {
      throw new Error(
        "NEXT_PUBLIC_APP_URL is localhost — every ticket would carry a dead " +
          "link. Compose an env file with https://test.dcica.org.",
      );
    }
    if (!env.NEXT_PUBLIC_APP_URL.includes("test.")) {
      throw new Error(
        `NEXT_PUBLIC_APP_URL is ${env.NEXT_PUBLIC_APP_URL} — this script is for ` +
          "the TEST host. Refusing to mint rehearsal tickets against prod.",
      );
    }
    if (env.EMAIL_PROVIDER !== "ses") {
      throw new Error(
        `EMAIL_PROVIDER is "${env.EMAIL_PROVIDER}" — only the SES adapter ` +
          "actually sends; the others log to console and return false.",
      );
    }
    const ses = await getSesAccountStatus();
    console.log(`  ses account     productionAccess=${ses?.productionAccess} sendingEnabled=${ses?.sendingEnabled}`);
    // A sandboxed account delivers ONLY to verified addresses, so it would
    // confirm all twelve orders and quietly drop every gmail recipient.
    if (!ses?.productionAccess) {
      throw new Error(
        "SES is in sandbox — unverified recipients are dropped silently. " +
          "Request production access, or run without --send.",
      );
    }
  }

  // ── Resolve ─────────────────────────────────────────────────────────────
  const event = await db.event.findFirstOrThrow({
    where: { code: EVENT_CODE },
    include: { caps: { include: { serviceType: true } }, volunteerRoles: true },
  });
  const now = new Date();
  const startsAt = new Date(now.getTime() - DOORS_OPENED_MINUTES_AGO * 60_000);
  const endsAt = new Date(now.getTime() + RUNS_FOR_HOURS * 3_600_000);

  const otherActive = await db.event.findMany({
    where: { orgId: event.orgId, status: "ACTIVE", code: { not: EVENT_CODE } },
    select: { id: true, code: true },
  });

  console.log(`\n  event           ${event.code} "${event.name}"`);
  console.log(`  status          ${event.status} -> ACTIVE`);
  console.log(`  window          ${event.startsAt.toISOString()} -> ${startsAt.toISOString()}`);
  console.log(`                  ${event.endsAt.toISOString()} -> ${endsAt.toISOString()}`);
  console.log(`  walkInOpensAt   ${event.walkInOpensAt?.toISOString() ?? "null"} -> ${now.toISOString()}`);
  console.log(`  name            -> ${REHEARSAL_NAME}`);
  console.log(`  location        -> ${REHEARSAL_LOCATION}`);
  console.log(`  close others    ${otherActive.map((e) => e.code).join(", ") || "(none ACTIVE)"}`);

  // walkInOpensAt is not cosmetic: isRegistrationOpen() treats an ACTIVE event
  // as closed unless it is set, so without it /register would refuse the
  // Round 1 card purchases the moment we flip the event ACTIVE.

  console.log(`\n  offerings:`);
  for (const c of event.caps) {
    const target = c.serviceType.key === TENPACK ? ` -> cap ${TENPACK_REHEARSAL_CAP}` : "";
    console.log(
      `    ${c.serviceType.key.padEnd(20)} ${String(c.serviceType.kind).padEnd(10)} ` +
        `admits=${String(c.serviceType.admitsCount).padEnd(3)} ${money(c.priceCents).padEnd(8)} ` +
        `door=${c.onsitePriceCents !== null ? money(c.onsitePriceCents) : "same"} ` +
        `cap=${c.capacity ?? "inf"} sold=${c.sold}${target}`,
    );
  }

  // ── The manifest, priced from the cap rows ──────────────────────────────
  const priceOf = new Map(event.caps.map((c) => [c.serviceType.key, c.priceCents]));
  const admitsOf = new Map(event.caps.map((c) => [c.serviceType.key, c.serviceType.admitsCount]));
  let grand = 0;
  let heads = 0;

  console.log(`\n  roster (${ROSTER.length}):`);
  for (const r of ROSTER) {
    let total = 0;
    let admits = 0;
    for (const it of r.items) {
      const p = priceOf.get(it.serviceKey);
      if (p === undefined) throw new Error(`${EVENT_CODE} does not offer "${it.serviceKey}"`);
      total += p * it.quantity;
      if (admitsOf.get(it.serviceKey)) {
        const kind = event.caps.find((c) => c.serviceType.key === it.serviceKey)!.serviceType.kind;
        if (kind === "ADMISSION") admits += (admitsOf.get(it.serviceKey) ?? 1) * it.quantity;
      }
    }
    grand += total;
    heads += admits;
    const items = r.items.map((i) => `${i.quantity}x ${i.serviceKey}`).join(" + ");
    console.log(`    ${r.name.padEnd(20)} ${r.email.padEnd(28)} ${money(total).padStart(8)}  ${String(admits).padStart(2)} tickets  ${items}`);
  }
  console.log(`    ${"".padEnd(20)} ${"TOTAL".padEnd(28)} ${money(grand).padStart(8)}  ${String(heads).padStart(2)} tickets`);

  console.log(`\n  volunteers      ${VOLUNTEERS.length} signups with VOL- codes (@rehearsal.invalid — no email sent)`);
  console.log(`  refund fixture  ${REFUND_FIXTURE.email} (confirmed, then marked REFUNDED by hand)`);

  if (!COMMIT) {
    console.log(`\n  DRY RUN — nothing written, nothing sent. Re-run with --commit [--send].\n`);
    await db.$disconnect();
    return;
  }

  // ── 1. Re-time and activate ─────────────────────────────────────────────
  await db.event.update({
    where: { id: event.id },
    data: {
      status: "ACTIVE",
      startsAt,
      endsAt,
      walkInOpensAt: now,
      name: REHEARSAL_NAME,
      location: REHEARSAL_LOCATION,
    },
  });
  console.log(`\n  ok  ${EVENT_CODE} is ACTIVE and in window`);

  // ── 2. Exactly one ACTIVE event ─────────────────────────────────────────
  // Both the scan station and the volunteer station resolve "the active event"
  // with no picker, so a second one makes which-event-am-I-on ambiguous.
  for (const e of otherActive) {
    await db.event.update({ where: { id: e.id }, data: { status: "CLOSED" } });
    console.log(`  ok  closed ${e.code} (was ACTIVE)`);
  }

  // ── 3. Shrink the 10-pack cap for the sold-out drill ────────────────────
  const tenpack = event.caps.find((c) => c.serviceType.key === TENPACK);
  if (tenpack) {
    if (tenpack.sold > TENPACK_REHEARSAL_CAP) {
      console.log(`  --  ${TENPACK} already sold ${tenpack.sold}; leaving cap at ${tenpack.capacity}`);
    } else {
      await db.serviceCap.update({
        where: { id: tenpack.id },
        data: { capacity: TENPACK_REHEARSAL_CAP },
      });
      console.log(`  ok  ${TENPACK} cap ${tenpack.capacity} -> ${TENPACK_REHEARSAL_CAP}`);
    }
  }

  // ── 4. Volunteer signups with codes ─────────────────────────────────────
  // findSignupByCodeOrThrow is scoped to the ACTIVE event, and every existing
  // signup sits on MC-2027S, so without these the volunteer station has
  // nothing to find.
  let volN = 0;
  for (const v of VOLUNTEERS) {
    const role = event.volunteerRoles.find((r) => r.name === v.role);
    if (!role) {
      console.log(`  --  no volunteer role "${v.role}" on this event; skipped ${v.name}`);
      continue;
    }
    const volunteer = await db.volunteer.upsert({
      where: { orgId_email: { orgId: event.orgId, email: v.email } },
      update: { name: v.name },
      create: { orgId: event.orgId, name: v.name, email: v.email },
    });
    volN += 1;
    const code = `VOL-${EVENT_CODE}-${String(volN).padStart(4, "0")}`;
    await db.volunteerSignup.upsert({
      where: { volunteerId_eventId: { volunteerId: volunteer.id, eventId: event.id } },
      update: { code, status: "CONFIRMED", roleId: role.id, checkedInAt: null, checkedOutAt: null, hoursServed: null },
      create: { volunteerId: volunteer.id, eventId: event.id, roleId: role.id, code, status: "CONFIRMED" },
    });
    console.log(`  ok  volunteer ${code}  ${v.name} (${v.role})`);
  }

  // ── 4b. Staff invites (real Google logins) ──────────────────────────────
  for (const inv of STAFF_INVITES) {
    const email = inv.email.toLowerCase();
    const existingMember = await db.membership.findFirst({
      where: { orgId: event.orgId, user: { email } },
      select: { role: true },
    });
    if (existingMember) {
      console.log(`  --  ${email} is already a member (${existingMember.role})`);
      continue;
    }
    const before = await db.invite.findUnique({
      where: { orgId_email: { orgId: event.orgId, email } },
      select: { acceptedAt: true },
    });
    if (before?.acceptedAt) {
      console.log(`  --  ${email} invite already accepted`);
      continue;
    }
    await db.invite.upsert({
      where: { orgId_email: { orgId: event.orgId, email } },
      update: { role: inv.role, canHoldTill: inv.canHoldTill },
      create: {
        orgId: event.orgId,
        email,
        role: inv.role,
        canHoldTill: inv.canHoldTill,
      },
    });
    console.log(`  ok  invite ${email} -> ${inv.role}${inv.canHoldTill ? " (till)" : ""}`);
  }

  // ── 5. Refunded fixture ─────────────────────────────────────────────────
  // There is no refund action anywhere in the app — refunds happen in the
  // Stripe dashboard and app state is corrected by hand. This reproduces that
  // end state so Round 7 has something to scan.
  const existingRefund = await db.order.findFirst({
    where: { eventId: event.id, registrantEmail: REFUND_FIXTURE.email },
    select: { id: true, status: true },
  });
  if (existingRefund?.status === "REFUNDED") {
    console.log(`  --  refund fixture already present (${existingRefund.id})`);
  } else {
    const created = await createRegistration({
      eventId: event.id,
      registrant: { name: REFUND_FIXTURE.name, email: REFUND_FIXTURE.email, phone: ROSTER_PHONE },
      marketingConsent: false,
      quantities: [{ serviceKey: ENTRY, quantity: 1 }],
    });
    await confirmOrderPaid(created.orderId, {
      method: "CASH",
      idempotencyKey: `rehearsal-refund-${created.orderId}`,
    });
    await db.$transaction([
      db.order.update({ where: { id: created.orderId }, data: { status: "REFUNDED" } }),
      db.lineItem.updateMany({ where: { orderId: created.orderId }, data: { status: "REFUNDED" } }),
      db.payment.updateMany({ where: { orderId: created.orderId }, data: { status: "REFUNDED" } }),
    ]);
    console.log(`  ok  refund fixture ${created.orderId} -> REFUNDED`);
  }

  // ── 6. Mint the roster ──────────────────────────────────────────────────
  if (!SEND) {
    console.log(`\n  SETUP DONE. Roster NOT minted (no --send), so no email left the building.`);
  } else {
    console.log(`\n  minting ${ROSTER.length} orders — this sends real email:`);
    for (const r of ROSTER) {
      const already = await db.order.findFirst({
        where: { eventId: event.id, registrantEmail: r.email, status: "CONFIRMED" },
        select: { id: true, attendees: { select: { campId: true } } },
      });
      if (already) {
        console.log(`    skip  ${r.name.padEnd(20)} already CONFIRMED (${already.id})`);
        continue;
      }
      try {
        const created = await createRegistration({
          eventId: event.id,
          registrant: { name: r.name, email: r.email, phone: ROSTER_PHONE },
          marketingConsent: false,
          quantities: r.items,
        });
        const res = await confirmOrderPaid(created.orderId, {
          method: "CASH",
          idempotencyKey: `rehearsal-${created.orderId}`,
        });
        console.log(`    ok    ${r.name.padEnd(20)} ${money(created.totalCents).padStart(8)}  ${res.campIds.length} ticket(s)`);
      } catch (e) {
        console.log(`    FAIL  ${r.name.padEnd(20)} ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── 7. Print pack ───────────────────────────────────────────────────────
  await printPack(db, event.id, env.NEXT_PUBLIC_APP_URL);
  await db.$disconnect();
}

/**
 * What to print, and what each sheet is for. The multi-ticket orders matter
 * most: the confirmation email spaces its QRs 260px apart so only one lands in
 * a camera frame, and printing collapses that.
 */
async function printPack(
  db: Awaited<ReturnType<typeof getDb>>,
  eventId: string,
  appUrl: string,
): Promise<void> {
  const rosterEmails = new Set(ROSTER.map((r) => r.email.toLowerCase()));
  const orders = await db.order.findMany({
    where: { eventId, status: { in: ["CONFIRMED", "REFUNDED"] } },
    select: {
      status: true,
      registrantName: true,
      registrantEmail: true,
      attendees: { select: { campId: true, checkedInAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n  ── PRINT PACK ──────────────────────────────────────────`);
  for (const o of orders) {
    const mine = rosterEmails.has((o.registrantEmail ?? "").toLowerCase());
    const tag = o.status === "REFUNDED" ? "REFUNDED" : mine ? "roster" : "pre-existing";
    const ids = o.attendees.map((a) => a.campId).filter(Boolean) as string[];
    if (ids.length === 0) continue;
    console.log(`\n  ${o.registrantName} [${tag}] — ${ids.length} ticket(s)`);
    for (const id of ids) console.log(`    ${id}   ${appUrl}/t/${id}`);
    if (ids.length > 1) {
      console.log(`    ^ PRINT THIS ONE — ${ids.length} QRs on one sheet is the paper worst case`);
    }
  }

  const vols = await db.volunteerSignup.findMany({
    where: { eventId, code: { not: null } },
    select: { code: true, volunteer: { select: { name: true } }, role: { select: { name: true } } },
  });
  console.log(`\n  volunteer codes (type these whole — the station does no prefix expansion):`);
  for (const v of vols) {
    console.log(`    ${v.code}   ${v.volunteer.name} — ${v.role.name}`);
  }
  console.log("");
}

async function getDb() {
  const { db } = await import("../src/lib/db");
  return db;
}

main().catch(async (e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
