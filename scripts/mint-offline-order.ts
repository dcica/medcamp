/**
 * Mint tickets for people who paid OUTSIDE the checkout — Zelle, a mailed
 * check, cash handed to a committee member — and send them the same
 * confirmation email, with the same scannable QR codes, that a card buyer gets.
 *
 *   ENV_FILE=<env> npx tsx scripts/mint-offline-order.ts             # dry run
 *   ENV_FILE=<env> MINT_TEST_EMAIL=you@example.com \
 *     npx tsx scripts/mint-offline-order.ts --commit                 # writes
 *   ENV_FILE=<env> npx tsx scripts/mint-offline-order.ts --resend    # email only
 *
 * WHY THIS EXISTS. The org publishes a Zelle handle alongside the online form,
 * so money arrives with no order attached to it. Before this script the only
 * ways to give those people a ticket were to hand-write rows (no cap decrement,
 * no ledger entry, no email) or to tell them to pay a second time. Both were
 * used at least once.
 *
 * WHAT IT DOES NOT DO. It does not write a single row itself. Every entry goes
 * through the two functions the card path already funnels through:
 *
 *   createRegistration()  — resolves the price from THIS EVENT's cap row, so
 *                           the manifest below cannot set a price; it can only
 *                           be wrong about one, which §amount catches.
 *   confirmOrderPaid()    — one transaction: atomic cap decrement, campId
 *                           assignment, line items -> PAID, Payment{SUCCEEDED},
 *                           LedgerEntry{CREDIT}. Then, outside it, the
 *                           confirmation email with an inline QR per ticket.
 *
 * So an offline sale lands in reconciliation identically to a card sale, with
 * `method` naming how the money actually arrived.
 *
 * IDEMPOTENT, AND SELF-HEALING IN THE MIDDLE. `ref` becomes the order's
 * idempotencyKey (the Zelle transaction number, where there is one). A re-run
 * skips an order that is already CONFIRMED, and RE-CONFIRMS one that was
 * created but not confirmed — the window between the two calls is the only
 * place this script can be interrupted, and that is what heals it.
 *
 * THE ENV IS THE SHARP EDGE. `.env.prod` carries the database and nothing else,
 * and every missing key here FAILS QUIET rather than loud:
 *   - no NEXT_PUBLIC_APP_URL -> env.ts defaults it to http://localhost:3000,
 *     and a real buyer gets a localhost link to "view your QR badge online";
 *   - no EMAIL_PROVIDER/AWS_REGION -> send() logs the mail to the console and
 *     returns delivered:false, and confirmOrderPaid SWALLOWS that by design
 *     (email must never roll back a paid order). The order confirms, the ticket
 *     never arrives, and nothing goes red.
 * Hence the preflight below, which prints both and refuses to --commit on a
 * localhost app URL.
 *
 * THE EMAIL IS THE TICKET, so "did it send?" is not a detail here. Three
 * separate mechanisms, because confirmOrderPaid's dispatch() catches and logs
 * provider errors rather than throwing them (it must: a slow SES must never
 * roll back a sale that has already been paid for):
 *
 *   1. PROOF FIRST. --commit refuses to run until sendTestEmail() — which
 *      RETHROWS, unlike dispatch() — has delivered to MINT_TEST_EMAIL. Credentials,
 *      region, verified From, sandbox posture: all exercised before a single
 *      order exists.
 *   2. DETECTION. `log` is a plain object, so log.error/log.warn are wrapped
 *      around each confirm call. The swallowed "email send failed" and the
 *      degraded "MIME/QR build failed" both surface as a per-entry FAIL instead
 *      of vanishing into a log nobody reads.
 *   3. REMEDY. --resend re-sends the confirmation for orders already in the
 *      manifest WITHOUT touching money — no re-confirm, no second cap
 *      decrement, no duplicate ledger row. This is the fix when (2) fires.
 */
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// Same reasoning as verify-checkout.ts: this machine has a global DATABASE_URL
// pointing at an unrelated project, and dotenv will not override an already-set
// shell var without this. Every src import below is therefore a dynamic
// `await import`, so nothing constructs Prisma or validates env against the
// stale value.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
const RESEND = process.argv.includes("--resend");
/** Where the mandatory pre-commit proof send goes. */
const TEST_EMAIL = process.env.MINT_TEST_EMAIL ?? "";

/** The event these tickets belong to, by its stable code. */
const EVENT_CODE = "GARBA-2026";

type Entry = {
  /** Registrant name, as it should read on the order and in the email. */
  name: string;
  email: string;
  /** Required by registrationSchema (min 7 chars) — the only contact channel a
   *  ticket has besides email. A sentinel is honest; an invented number is not. */
  phone: string;
  /** Service key on the event's menu. Price comes from the cap row, not here. */
  serviceKey: string;
  quantity: number;
  /** What actually landed in the bank, in cents. Checked against the resolved
   *  price BEFORE anything is created — see assertAmount. */
  amountCents: number;
  /** How the money arrived. */
  method: "ZELLE" | "CHECK" | "CASH";
  /** Stable idempotency ref — the payment's transaction number where there is
   *  one. Becomes Order.idempotencyKey and Payment.idempotencyKey. */
  ref: string;
  /** Free-text, for the run log only. Not stored. */
  note?: string;
};

/**
 * APPEND, DON'T OVERWRITE. This list is a log of every offline payment ever
 * minted, not a scratchpad for the current one. A re-run skips anything already
 * CONFIRMED (see `ref` above), so leaving finished entries in place costs one
 * cheap lookup each and buys an audit trail plus a worked example. Clearing it
 * would also throw away the only record of which Zelle transaction produced
 * which order.
 *
 * ── MINTED 2026-08-25 (GARBA-2026, 8 tickets, $40.00) ────────────────────────
 * All four entries below are CONFIRMED and emailed. Leave them.
 */
const MANIFEST: Entry[] = [
  {
    // Zelle names her BHUVANESWARI MOHAN; the address and her own memo both say
    // "Bhuvana". The email is what she will recognise the ticket by, so the
    // order reads the way she writes it.
    name: "Bhuvana Mohan",
    email: "gbhuvana10@gmail.com",
    phone: "000-000-0000",
    serviceKey: "garba-class-entry",
    quantity: 1,
    amountCents: 500,
    method: "ZELLE",
    ref: "zelle-30500227223",
    note: "Garbha class - Bhuvana Mohan — sent Aug 21 2026",
  },
  {
    name: "Saurabh Shukla",
    email: "sssauurabh@gmail.com",
    phone: "000-000-0000",
    serviceKey: "garba-class-entry",
    quantity: 4,
    amountCents: 2000,
    method: "ZELLE",
    ref: "zelle-30509174880",
    note: "Saurabh, Niharika, Aurika and Avirbhav — sent Aug 22 2026",
  },
  {
    // Zelle names her LAVANGA PAMARTHI; the address says "latha.murala11", and
    // the account is registered to Latha Pamarthi. Going with the address.
    name: "Latha Pamarthi",
    email: "latha.murala11@gmail.com",
    phone: "000-000-0000",
    serviceKey: "garba-class-entry",
    quantity: 1,
    amountCents: 500,
    method: "ZELLE",
    ref: "zelle-30526441724",
    note: "sent Aug 23 2026, no memo",
  },
  {
    name: "Ashutosh Jaiswal",
    email: "jaiswal.ashutosh@gmail.com",
    phone: "000-000-0000",
    serviceKey: "garba-class-entry",
    quantity: 2,
    amountCents: 1000,
    method: "ZELLE",
    ref: "zelle-30527014305",
    note: "Ashutosh Jaiswal, Nitasha Chopra — sent Aug 23 2026",
  },

  // ── MINTED 2026-09-13 (GARBA-2026, 3 tickets, $15.00) ───────────────────────
  {
    // Zelle names her SONAL S MAHAJAN; the address is "sonal.work.6", so the
    // order reads "Sonal Mahajan".
    name: "Sonal Mahajan",
    email: "sonal.work.6@gmail.com",
    phone: "000-000-0000",
    serviceKey: "garba-class-entry",
    quantity: 3,
    amountCents: 1500,
    // ASSUMED, not evidenced. No amount, method or transaction number was
    // supplied for this one — only "three tickets". $15.00 is the only value
    // consistent with 3 units at the cap's $5.00, and ZELLE is the channel every
    // other entry here came through. If the money actually arrived as cash or a
    // check, the Payment and LedgerEntry rows need their `method` corrected;
    // nothing else about the order changes.
    method: "ZELLE",
    // No transaction number captured, so the ref is derived from the payer —
    // still unique, still stable across re-runs. Same shape Bhuvana's had before
    // her txn number turned up.
    ref: "zelle-garba2026-sonal.work.6",
    note: "Sonal S Mahajan — 3 tickets, no txn number supplied",
  },

  // ── OUTSTANDING: cannot be minted yet ──────────────────────────────────────
  // Lavanya Navudu, $10.00, txn 30514464982, memo "Vudaya and Divya garba dance
  // class dues" — 2 tickets. NO EMAIL ADDRESS, and the confirmation email IS the
  // ticket, so there is nowhere to send it. Uncomment and fill in `email` once
  // the address is known; `ref` is already fixed, so the run stays idempotent.
  // {
  //   name: "Lavanya Navudu",
  //   email: "",                      // <- the only missing piece
  //   phone: "000-000-0000",
  //   serviceKey: "garba-class-entry",
  //   quantity: 2,
  //   amountCents: 1000,
  //   method: "ZELLE",
  //   ref: "zelle-30514464982",
  //   note: "Vudaya and Divya garba dance class dues — sent Aug 22 2026",
  // },
];

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

let failures = 0;
function fail(msg: string): void {
  console.log(`  FAIL  ${msg}`);
  failures++;
}

/**
 * Run `fn` while watching the logger for the two ways a confirmation email can
 * fail without anyone noticing. dispatch() logs and swallows both — that is
 * correct for the webhook, and useless for an operator standing here waiting to
 * know whether four people got their tickets. Returns whatever the logger
 * caught, so the caller can turn silence into a FAIL line.
 *
 * Wrapping works because `log` is a plain object literal of function
 * properties, not a frozen module namespace. The originals are always restored.
 */
async function watchingEmailLog<T>(
  log: { error: (m: string, f?: Record<string, unknown>) => void; warn: (m: string, f?: Record<string, unknown>) => void },
  fn: () => Promise<T>,
): Promise<{ result: T; problems: string[] }> {
  const problems: string[] = [];
  const realError = log.error;
  const realWarn = log.warn;
  const sniff = (msg: string, fields?: Record<string, unknown>) => {
    // The exact strings dispatch()/send() emit in src/lib/email.ts.
    if (
      msg.includes("email send failed") ||
      msg.includes("MIME/QR build failed") ||
      msg.includes("email logged to console") ||
      msg.includes("email not delivered")
    ) {
      const err = fields?.err;
      problems.push(
        `${msg}${err ? `: ${err instanceof Error ? err.message : JSON.stringify(err)}` : ""}`,
      );
    }
  };
  log.error = (m, f) => {
    sniff(m, f);
    realError(m, f);
  };
  log.warn = (m, f) => {
    sniff(m, f);
    realWarn(m, f);
  };
  try {
    return { result: await fn(), problems };
  } finally {
    log.error = realError;
    log.warn = realWarn;
  }
}

async function main() {
  const { env } = await import("../src/lib/env");
  const { getSesAccountStatus, sendTestEmail, sendConfirmationEmail } =
    await import("../src/lib/email");
  const { log } = await import("../src/lib/logger");
  const { createRegistration } = await import("../src/server/registration");
  const { confirmOrderPaid } = await import("../src/server/payments");

  console.log(`\n${RESEND ? "RESEND" : COMMIT ? "COMMIT" : "DRY RUN"} — mint-offline-order`);
  console.log(`  env file        ${process.env.ENV_FILE ?? ".env"}`);

  // ── Preflight: the two things that fail quiet ──────────────────────────────
  console.log(`\n§ preflight`);
  console.log(`  app url         ${env.NEXT_PUBLIC_APP_URL}`);
  if (COMMIT && env.NEXT_PUBLIC_APP_URL.includes("localhost")) {
    fail(
      "NEXT_PUBLIC_APP_URL is localhost — every confirmation email would carry " +
        "a dead 'view your QR badge online' link. Refusing to commit.",
    );
  }
  console.log(`  email provider  ${env.EMAIL_PROVIDER} (from: ${env.EMAIL_FROM})`);
  const ses = await getSesAccountStatus();
  if (ses) {
    console.log(
      `  ses account     productionAccess=${ses.productionAccess} sendingEnabled=${ses.sendingEnabled}`,
    );
    // Sandbox only delivers to verified addresses. Every recipient here is an
    // unverified gmail, so a sandboxed account confirms the orders and silently
    // bounces all four tickets.
    if (COMMIT && !ses.productionAccess) {
      fail("SES is in the SANDBOX — real recipients will bounce. Refusing to commit.");
    }
    if (COMMIT && !ses.sendingEnabled) {
      fail("SES sending is DISABLED for this account. Refusing to commit.");
    }
  } else {
    console.log(`  ses account     (unavailable — not on SES, or creds lack ses:GetAccount)`);
    if (COMMIT && env.EMAIL_PROVIDER !== "ses") {
      fail(
        `EMAIL_PROVIDER is "${env.EMAIL_PROVIDER}" — the confirmation email would be ` +
          "logged to the console, not sent, and confirmOrderPaid swallows that. " +
          "Refusing to commit.",
      );
    }
  }

  // ── Proof: an actual delivered message, before a single order exists ──────
  // sendTestEmail RETHROWS provider errors (unlike the dispatch() path the
  // confirmation goes through), so this is the one place a broken SES setup can
  // still stop the run. Everything after this point fails silently instead.
  if (COMMIT || RESEND) {
    if (!TEST_EMAIL) {
      fail(
        "MINT_TEST_EMAIL is unset. The confirmation email IS the ticket, and the " +
          "send path swallows its own errors — so a real delivery must be proven " +
          "first. Re-run with MINT_TEST_EMAIL=<your address>.",
      );
    } else {
      try {
        const { delivered } = await sendTestEmail(TEST_EMAIL);
        if (delivered) {
          console.log(`  proof send      ok — delivered to ${TEST_EMAIL}`);
        } else {
          fail(
            `proof send to ${TEST_EMAIL} was NOT delivered (no provider wired up — ` +
              "it went to the console). Confirmation emails would do the same.",
          );
        }
      } catch (err) {
        fail(
          `proof send to ${TEST_EMAIL} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── Resolve the event and its menu ────────────────────────────────────────
  const event = await db.event.findFirst({
    where: { code: EVENT_CODE },
    include: { caps: { include: { serviceType: true } }, org: true },
  });
  if (!event) {
    fail(`event ${EVENT_CODE} not found in this database`);
    return;
  }
  console.log(`\n§ event`);
  console.log(`  ${event.code}  ${event.name}`);
  console.log(`  org ${event.org.slug}   status ${event.status}   mode ${event.collectsAttendeeDetails ? "ATTENDEE" : "QUANTITY"}`);

  const byKey = new Map(event.caps.map((c) => [c.serviceType.key, c]));
  for (const c of event.caps) {
    console.log(
      `  service ${c.serviceType.key}  ${usd(c.priceCents)} online  ` +
        `cap ${c.capacity ?? "uncapped"}  sold ${c.sold}`,
    );
  }

  // ── Per-entry validation, before anything is created ──────────────────────
  //
  // The manifest is a LOG (see its header), so most entries on a typical run are
  // already minted. Resolve that up front: an entry whose `ref` is already
  // CONFIRMED is reported `done` and, crucially, is left OUT of the capacity
  // projection below — its units are already inside `cap.sold`, and counting
  // them again would double-count every past run and eventually report a
  // phantom sell-out.
  const priorByRef = new Map(
    (
      await db.order.findMany({
        where: { idempotencyKey: { in: MANIFEST.map((e) => e.ref) } },
        select: { idempotencyKey: true, status: true },
      })
    ).map((o) => [o.idempotencyKey as string, o.status]),
  );

  console.log(`\n§ manifest (${MANIFEST.length} entries)`);
  const wanted = new Map<string, number>(); // serviceKey -> units still to sell
  for (const e of MANIFEST) {
    const cap = byKey.get(e.serviceKey);
    if (!cap) {
      fail(`${e.email}: service "${e.serviceKey}" is not offered at ${EVENT_CODE}`);
      continue;
    }
    const prior = priorByRef.get(e.ref);
    // The price the buyer WOULD have been charged online, straight off the cap
    // row. If the manifest disagrees with it, the ticket count and the money
    // disagree, and one of the two is wrong — refuse rather than guess.
    const expected = cap.priceCents * e.quantity;
    const ok = expected === e.amountCents;
    const state =
      prior === "CONFIRMED" ? "done" : prior ? `${prior.toLowerCase()}` : "new";
    console.log(
      `  ${ok ? (state === "done" ? "done" : "ok  ") : "FAIL"}  ${e.name} <${e.email}>  ` +
        `${e.quantity} x ${usd(cap.priceCents)} = ${usd(expected)}  ` +
        `paid ${usd(e.amountCents)} by ${e.method}  ref ${e.ref}` +
        // "done" is already the status column; only a stalled prior state
        // (PENDING from an interrupted run, CANCELLED) needs calling out.
        (state === "new" || state === "done" ? "" : `  [prior order is ${state}]`),
    );
    if (!ok) {
      failures++;
      continue;
    }
    // Already CONFIRMED ⇒ already counted in cap.sold. Not pending work.
    if (prior === "CONFIRMED") continue;
    wanted.set(e.serviceKey, (wanted.get(e.serviceKey) ?? 0) + e.quantity);
  }

  // ── Capacity headroom, in aggregate ───────────────────────────────────────
  console.log(`\n§ capacity`);
  if (wanted.size === 0) {
    console.log(`  ---   nothing pending — every entry is already CONFIRMED`);
  }
  for (const [key, units] of wanted) {
    const cap = byKey.get(key)!;
    if (cap.capacity === null) {
      console.log(`  ok    ${key}: uncapped, ${units} units to add`);
      continue;
    }
    const after = cap.sold + units;
    const ok = after <= cap.capacity;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${key}: ${cap.sold} sold + ${units} = ${after} / ${cap.capacity}`,
    );
    if (!ok) failures++;
  }

  // Two totals, because the manifest is cumulative: what THIS run will do, and
  // what the file accounts for in total. Reporting only the second would claim
  // credit for every past run every time.
  const pending = MANIFEST.filter((e) => priorByRef.get(e.ref) !== "CONFIRMED");
  const totalCents = MANIFEST.reduce((s, e) => s + e.amountCents, 0);
  const totalTickets = MANIFEST.reduce((s, e) => s + e.quantity, 0);
  const pendingCents = pending.reduce((s, e) => s + e.amountCents, 0);
  const pendingTickets = pending.reduce((s, e) => s + e.quantity, 0);
  console.log(
    `\n  this run: ${pendingTickets} tickets, ${usd(pendingCents)}` +
      `   |   manifest total: ${totalTickets} tickets, ${usd(totalCents)}`,
  );

  if (failures > 0) {
    console.log(`\n${failures} problem(s) — nothing written.`);
    process.exitCode = 1;
    return;
  }

  // ── --resend: the email, and ONLY the email ───────────────────────────────
  // The remedy when a confirmation was swallowed. Reads the already-CONFIRMED
  // order and re-sends. No confirm call, so no second cap decrement, no second
  // Payment, no duplicate ledger row — the money side is untouched by design.
  //
  // The payload below MIRRORS the post-transaction block of confirmOrderPaid
  // (src/server/payments.ts). If that block's mapping changes, change this one:
  // there is no shared builder to import, and a silent divergence here sends a
  // ticket that disagrees with the one the card path sends.
  if (RESEND) {
    console.log(`\n§ resending`);
    for (const e of MANIFEST) {
      const order = await db.order.findUnique({
        where: { idempotencyKey: e.ref },
        include: {
          event: true,
          lineItems: { include: { serviceType: true } },
          attendees: { select: { campId: true } },
          performanceEntry: true,
        },
      });
      if (!order) {
        fail(`${e.email}: no order for ref ${e.ref} — nothing to resend`);
        continue;
      }
      if (order.status !== "CONFIRMED") {
        fail(`${e.email}: order ${order.id} is ${order.status}, not CONFIRMED — mint it first`);
        continue;
      }
      const campIds = order.attendees
        .map((a) => a.campId)
        .filter((c): c is string => Boolean(c));

      const { problems } = await watchingEmailLog(log, () =>
        sendConfirmationEmail({
          to: order.registrantEmail,
          registrantName: order.registrantName,
          eventName: order.event.name,
          confirmUrl: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}`,
          walletBaseUrl: env.NEXT_PUBLIC_APP_URL,
          campIds,
          performanceEntry: order.performanceEntry
            ? {
                groupName: order.performanceEntry.groupName,
                songTitle: order.performanceEntry.songTitle,
                songNeeded: order.performanceEntry.songObjectPath === null,
                entryUrl: `${env.NEXT_PUBLIC_APP_URL}/perform/${campIds[0] ?? ""}`,
              }
            : null,
          lineItems: order.lineItems.map((li) => ({
            description: li.serviceType?.name ?? li.description,
            quantity: li.quantity,
            amountCents: li.amountCents,
          })),
          merch: order.lineItems
            .filter((li) => li.serviceType?.kind === "MERCH")
            .map((li) => ({
              description: li.serviceType?.name ?? li.description,
              quantity: li.quantity,
            })),
          totalPaidCents: order.lineItems.reduce(
            (s, li) => s + li.amountCents * li.quantity,
            0,
          ),
          venue: order.event.location,
          startsAt: order.event.startsAt,
          endsAt: order.event.endsAt,
          allowsRefunds: order.event.allowsRefunds,
        }),
      );
      if (problems.length > 0) {
        fail(`${e.email}: resend failed — ${problems.join("; ")}`);
      } else {
        console.log(`  sent  ${e.name} <${e.email}>  ${campIds.length} ticket(s)`);
      }
    }
    console.log(failures === 0 ? `\nAll resends delivered.` : `\n${failures} resend(s) failed.`);
    if (failures > 0) process.exitCode = 1;
    return;
  }

  if (!COMMIT) {
    console.log(`\nDry run only. Re-run with --commit to write.`);
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  console.log(`\n§ minting`);
  for (const e of MANIFEST) {
    // Already handled? `ref` is the order's idempotencyKey, so this is the
    // guard against a double-mint on a re-run. CONFIRMED -> skip; PENDING ->
    // the previous run died between create and confirm, so finish the job.
    const prior = await db.order.findUnique({
      where: { idempotencyKey: e.ref },
      select: { id: true, status: true },
    });

    let orderId: string;
    if (prior) {
      if (prior.status === "CONFIRMED") {
        console.log(`  skip  ${e.email} — already CONFIRMED (${prior.id})`);
        continue;
      }
      console.log(`  heal  ${e.email} — order ${prior.id} was ${prior.status}, confirming`);
      orderId = prior.id;
    } else {
      const created = await createRegistration({
        eventId: event.id,
        registrant: { name: e.name, email: e.email, phone: e.phone },
        quantities: [{ serviceKey: e.serviceKey, quantity: e.quantity }],
        // These people paid by bank transfer; none of them was shown a consent
        // checkbox, so the honest value is false.
        marketingConsent: false,
      });
      orderId = created.orderId;

      // Belt to the pre-check's braces: this is the total the ORDER actually
      // carries, not the one computed from the cap. Checked before the order is
      // reachable by confirmation, so a mismatch leaves a PENDING order with no
      // money moved and no cap consumed.
      if (created.totalCents !== e.amountCents) {
        fail(
          `${e.email}: order ${orderId} totals ${usd(created.totalCents)} but ` +
            `${usd(e.amountCents)} was received — left PENDING, not confirmed`,
        );
        continue;
      }

      // Stamp the ref so a re-run finds this order instead of minting a second.
      await db.order.update({
        where: { id: orderId },
        data: { idempotencyKey: e.ref },
      });
    }

    // The confirmation email is sent from inside this call, on the far side of
    // the transaction — and its failures are logged, not thrown. Watch the
    // logger so a swallowed failure becomes a FAIL line here rather than a
    // ticket that never arrives.
    const { result, problems } = await watchingEmailLog(log, () =>
      confirmOrderPaid(orderId, { method: e.method, idempotencyKey: e.ref }),
    );
    const { alreadyConfirmed, campIds } = result;
    console.log(
      `  ${alreadyConfirmed ? "noop" : "done"}  ${e.name} <${e.email}>  ` +
        `order ${orderId}  ${campIds.length} ticket(s): ${campIds.join(", ")}`,
    );
    if (problems.length > 0) {
      fail(
        `${e.email}: order is CONFIRMED but the ticket email did NOT send — ` +
          `${problems.join("; ")}. Money is recorded; re-run with --resend.`,
      );
    } else if (!alreadyConfirmed) {
      console.log(`        email sent to ${e.email}`);
    }
  }

  // ── Verify what landed ────────────────────────────────────────────────────
  console.log(`\n§ verify`);
  const refs = MANIFEST.map((e) => e.ref);
  const orders = await db.order.findMany({
    where: { idempotencyKey: { in: refs } },
    select: {
      id: true,
      status: true,
      method: true,
      registrantEmail: true,
      idempotencyKey: true,
      attendees: { select: { campId: true } },
      payments: { select: { status: true, method: true, amountCents: true } },
    },
  });
  for (const e of MANIFEST) {
    const o = orders.find((x) => x.idempotencyKey === e.ref);
    if (!o) {
      fail(`${e.email}: no order found for ref ${e.ref}`);
      continue;
    }
    const paid = o.payments.filter((p) => p.status === "SUCCEEDED");
    const cents = paid.reduce((s, p) => s + p.amountCents, 0);
    const codes = o.attendees.filter((a) => a.campId).length;
    const ok =
      o.status === "CONFIRMED" &&
      o.method === e.method &&
      codes === e.quantity &&
      cents === e.amountCents;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${e.email}  ${o.status}/${o.method}  ` +
        `${codes}/${e.quantity} codes  ${usd(cents)}/${usd(e.amountCents)}`,
    );
  }

  const ledger = await db.ledgerEntry.findMany({
    where: {
      orgId: event.orgId,
      direction: "CREDIT",
      paymentId: { in: (await db.payment.findMany({
        where: { idempotencyKey: { in: refs } },
        select: { id: true },
      })).map((p) => p.id) },
    },
    select: { amountCents: true, method: true },
  });
  const ledgerCents = ledger.reduce((s, l) => s + l.amountCents, 0);
  const ledgerOk = ledger.length === MANIFEST.length && ledgerCents === totalCents;
  if (!ledgerOk) failures++;
  console.log(
    `  ${ledgerOk ? "ok  " : "FAIL"}  ledger: ${ledger.length}/${MANIFEST.length} CREDIT rows, ` +
      `${usd(ledgerCents)}/${usd(totalCents)}`,
  );

  const after = await db.serviceCap.findUnique({
    where: {
      eventId_serviceTypeId: {
        eventId: event.id,
        serviceTypeId: byKey.get(MANIFEST[0].serviceKey)!.serviceTypeId,
      },
    },
    select: { sold: true, capacity: true },
  });
  console.log(`  ---   cap now: ${after?.sold} / ${after?.capacity ?? "uncapped"} sold`);

  console.log(
    failures === 0
      ? pendingTickets === 0
        ? `\nNothing to do — all ${totalTickets} manifest tickets were already minted.`
        : `\n${pendingTickets} ticket(s) minted and emailed. ` +
          `Manifest now accounts for ${totalTickets} tickets, ${usd(totalCents)}.`
      : `\n${failures} problem(s) — read the FAIL lines above.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
