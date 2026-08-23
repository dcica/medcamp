/**
 * Checkout-return regression check — what happens when a buyer taps Stripe's
 * own back link instead of paying.
 *
 *   ENV_FILE=.env npx tsx scripts/verify-checkout.ts
 *
 * Sibling of verify-pricing.ts (the money path on good input) and
 * verify-validation.ts (the money path on bad input). This one covers the path
 * where there is no input at all: the buyer left.
 *
 * WHY THIS FILE EXISTS. Stripe's cancel_url carried `&cancelled=<orderId>` for
 * months with two producers and zero readers, so the buyer landed on a blank
 * form, retyped everything, and left a PENDING order behind. Nothing went red,
 * because nothing was watching — the failure is entirely in what does NOT
 * happen. Every row here pins a behaviour whose absence is silent:
 *
 *   - the cancel URL still says which order was abandoned
 *   - the session still has a deadline, so the orphan still gets reaped
 *   - the reaper still refuses to cancel an order somebody is paying for
 *   - resuming still refuses a caller who cannot prove the order is theirs
 *
 * WHAT IT ASSERTS AGAINST: pure helpers and server functions, never the
 * component tree — a row here must survive RegisterForm.tsx being rewritten.
 *
 * ── MUTATION TESTS (each was made once, observed red, and reverted) ──
 *   §1  bump DRAFT_VERSION in saveDraft only          → round-trip row fails
 *   §2  drop `cancelled` from buildCheckoutReturn     → contract rows fail
 *   §3  change CHECKOUT_TTL_SECONDS to 30 * 60        → deadline row fails
 *   §4  return true instead of timingSafeEqual(...)   → every forgery row fails
 *   §5  drop the `live > 0` guard in reapExpiredCheckout → resumed-order row fails
 *   §6  delete the CONFIRMED branch of resumeCheckoutForOrder → receipt rows fail
 *   §7  key the resume action on IP alone             → per-order bucket row fails
 *   §8  return early instead of setting a no-draft baseline → tab-loss row fails
 */
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Same reasoning as verify-performance.ts: the machine has a global
// DATABASE_URL pointing at an unrelated project and dotenv will not override an
// already-set shell var without this. Every src import below is therefore a
// dynamic `await import`, so nothing constructs Prisma against the stale value.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

// Pinned before any src import so the MAC is deterministic here and does not
// depend on which of the three fallback rungs a given .env happens to have.
process.env.CHECKOUT_RESUME_SECRET = "verify-checkout-fixed-secret";

const db = new PrismaClient();

const CODE = "VERIFY-CHECKOUT";
const SERVICE_KEY = "verify-checkout-admit";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Minimal sessionStorage so the draft module can be exercised outside a browser. */
function installSessionStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  };
  return backing;
}

async function main() {
  const { buildCheckoutReturn, CHECKOUT_TTL_SECONDS } = await import(
    "../src/lib/checkoutReturn"
  );
  const { signResumeProof, verifyResumeProof, resolveResumeSecret } = await import(
    "../src/lib/checkoutResume"
  );
  const draftMod = await import("../src/lib/checkoutDraft");
  const { hasEdits, snapshot } = draftMod;
  const { reapExpiredCheckout, resumeCheckoutForOrder, getResumableCheckout } =
    await import("../src/server/payments");
  const { guardKey } = await import("../src/server/requestGuard");
  const { resetRateLimits } = await import("../src/lib/rateLimit");

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§1 the draft survives the hop, and refuses to half-survive it");
  const backing = installSessionStorage();
  const KEY = draftMod.DRAFT_KEY.perform;

  // The tri-state is the trap: `null` means "skipped the question", which a
  // coordinator planning stage changeovers reads differently from "No". A
  // restore that collapses it to false loses information nobody will miss until
  // show night.
  const values = {
    groupName: "Shakti Steps",
    participants: "8",
    usesProps: null as boolean | null,
    needsStagePrep: false,
    marketingConsent: true,
  };
  draftMod.saveDraft(KEY, { eventId: "evt1", orderId: "ord1", values });

  const back = draftMod.loadDraft<typeof values>(KEY, "evt1");
  check("round-trips every field", JSON.stringify(back?.values) === JSON.stringify(values));
  check("carries the order it was submitted as", back?.orderId === "ord1");
  check(
    "tri-state null is preserved, not collapsed to false",
    back?.values.usesProps === null,
  );
  check("false is preserved as false", back?.values.needsStagePrep === false);
  check(
    "a draft for another event is refused, not half-applied",
    draftMod.loadDraft(KEY, "evt-other") === null,
  );

  backing.set(KEY, "{not json");
  check("unparseable draft returns null rather than throwing", draftMod.loadDraft(KEY, "evt1") === null);
  backing.set(KEY, JSON.stringify({ v: 999, eventId: "evt1", orderId: "o", values }));
  check("draft from another version is discarded", draftMod.loadDraft(KEY, "evt1") === null);
  backing.set(KEY, JSON.stringify({ v: draftMod.DRAFT_VERSION, eventId: "evt1", values }));
  check("draft with no orderId is discarded", draftMod.loadDraft(KEY, "evt1") === null);

  draftMod.saveDraft(KEY, { eventId: "evt1", orderId: "ord1", values });
  draftMod.clearDraft(KEY);
  check("clearDraft removes it", draftMod.loadDraft(KEY, "evt1") === null);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§2 the cancel URL still says which order was abandoned");
  const APP = "https://example.org";
  const withEvent = buildCheckoutReturn({ id: "ord_1", eventId: "evt_1" }, APP);
  check(
    "default cancel URL carries cancelled=",
    withEvent.cancelUrl.includes("cancelled=ord_1"),
    withEvent.cancelUrl,
  );
  check("default cancel URL carries event=", withEvent.cancelUrl.includes("event=evt_1"));
  check("default cancel path is /register", withEvent.cancelUrl.startsWith(`${APP}/register?`));
  check(
    "default success URL keeps Stripe's unencoded placeholder",
    withEvent.successUrl === `${APP}/confirm/ord_1?session_id={CHECKOUT_SESSION_ID}`,
    withEvent.successUrl,
  );

  // The override path is the one that regressed before: /perform hand-wrote its
  // own cancel query, so the contract lived in two places and only one of them
  // was ever read.
  const overridden = buildCheckoutReturn({ id: "ord_2", eventId: "evt_2" }, APP, {
    successPath: "/perform/after-payment/ord_2",
    cancelPath: "/perform",
  });
  check(
    "path-override caller ALSO gets cancelled=",
    overridden.cancelUrl.includes("cancelled=ord_2"),
    overridden.cancelUrl,
  );
  check("path-override cancel path is honoured", overridden.cancelUrl.startsWith(`${APP}/perform?`));
  check(
    "path-override success path is honoured",
    overridden.successUrl === `${APP}/perform/after-payment/ord_2?session_id={CHECKOUT_SESSION_ID}`,
  );

  // Order.eventId is non-null today, but membership and POS orders are not
  // event-scoped. The builder must already tolerate that rather than needing an
  // edit to the money path during a schema change.
  const noEvent = buildCheckoutReturn({ id: "ord_3", eventId: null }, APP);
  check("an order with no event still carries cancelled=", noEvent.cancelUrl.includes("cancelled=ord_3"));
  check("an order with no event omits event=", !noEvent.cancelUrl.includes("event="), noEvent.cancelUrl);
  check(
    "a trailing slash on APP_URL does not double up",
    buildCheckoutReturn({ id: "o", eventId: "e" }, "https://example.org/").cancelUrl.startsWith(
      "https://example.org/register?",
    ),
  );

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§3 the session has a deadline, so the orphan gets reaped");
  const t0 = new Date("2026-08-23T12:00:00Z");
  const dated = buildCheckoutReturn({ id: "o", eventId: "e" }, APP, {}, t0);
  check(
    "expiry is TTL seconds past the injected clock",
    dated.expiresAt === Math.floor(t0.getTime() / 1000) + CHECKOUT_TTL_SECONDS,
  );
  // Not Stripe's 30-minute floor, deliberately: 30 kills the session under a
  // walk-in who steps away mid-payment on venue wifi. See CHECKOUT_TTL_SECONDS.
  check("TTL is an hour, not Stripe's 30-minute floor", CHECKOUT_TTL_SECONDS === 3600, `${CHECKOUT_TTL_SECONDS}s`);
  check("TTL is within Stripe's accepted 30min–24h band", CHECKOUT_TTL_SECONDS >= 1800 && CHECKOUT_TTL_SECONDS <= 86400);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§4 the resume proof cannot be forged or replayed");
  const K = "test-key-one";
  const proofA = signResumeProof("order_A", K);
  check("a proof verifies for its own order", verifyResumeProof("order_A", proofA, K));
  // The replay case, and the reason the MAC is taken over the CALLER'S orderId
  // rather than the one embedded in the proof: a proof minted for the
  // attacker's own real order must not authorise an id they typed into the URL.
  check("a proof for A does NOT verify for B", !verifyResumeProof("order_B", proofA, K));
  check("a tampered MAC is refused", !verifyResumeProof("order_A", `order_A.${"x".repeat(43)}`, K));
  check("a truncated MAC is refused", !verifyResumeProof("order_A", `order_A.${(proofA ?? "").slice(9, 20)}`, K));
  check("a proof signed with another key is refused", !verifyResumeProof("order_A", signResumeProof("order_A", "other-key"), K));
  check("a missing proof is refused", !verifyResumeProof("order_A", null, K));
  check("a proof with no separator is refused", !verifyResumeProof("order_A", "order_A", K));
  check("no configured secret means no proof, and nothing verifies", signResumeProof("order_A", null) === null && !verifyResumeProof("order_A", proofA, null));

  check(
    "secret prefers CHECKOUT_RESUME_SECRET",
    resolveResumeSecret({ checkoutResumeSecret: "a", nextAuthSecret: "b", stripeSecretKey: "c" }) === "a",
  );
  check(
    "secret falls back to NEXTAUTH_SECRET",
    resolveResumeSecret({ nextAuthSecret: "b", stripeSecretKey: "c" }) === "b",
  );
  // The last rung matters: NEXTAUTH_SECRET is optional in the env schema, so
  // without this a deployment using only test-login would silently lose resume.
  check(
    "secret falls back to STRIPE_SECRET_KEY",
    resolveResumeSecret({ stripeSecretKey: "c" }) === "c",
  );
  check("no candidates means null", resolveResumeSecret({}) === null);
  check("an empty string is not a usable secret", resolveResumeSecret({ checkoutResumeSecret: "", nextAuthSecret: "b" }) === "b");

  // ─────────────────────────────────────────────────────────────────────────
  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "OPEN",
      code: CODE,
      name: "Checkout Return Verification",
      // Relative, never a literal: a hardcoded date turns this red the day it passes.
      startsAt: new Date(Date.now() + 30 * 24 * 3600_000),
      endsAt: new Date(Date.now() + 30 * 24 * 3600_000 + 4 * 3600_000),
      collectsAttendeeDetails: false,
      honorsMembership: false,
    },
  });
  const service = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: SERVICE_KEY } },
    update: { kind: "ADMISSION", priceCents: 2500 },
    create: { orgId: org.id, key: SERVICE_KEY, name: "Verify Admission", priceCents: 2500, kind: "ADMISSION" },
  });

  /** A PENDING order with one $25 line and, optionally, some checkout sessions. */
  async function makeOrder(
    status: "PENDING" | "CONFIRMED" | "CANCELLED",
    sessionIds: string[],
  ): Promise<string> {
    const order = await db.order.create({
      data: {
        orgId: org.id,
        eventId: event.id,
        status,
        registrantName: "Asha R",
        registrantEmail: "verify-checkout@example.org",
        registrantPhone: "5551234567",
        lineItems: {
          create: [
            {
              orgId: org.id,
              serviceTypeId: service.id,
              description: "Verify Admission",
              amountCents: 2500,
              quantity: 1,
              status: "PENDING_PAYMENT",
            },
          ],
        },
      },
      select: { id: true },
    });
    for (const sid of sessionIds) {
      await db.payment.create({
        data: {
          orgId: org.id,
          orderId: order.id,
          method: "STRIPE",
          status: "PENDING",
          amountCents: 2500,
          stripeCheckoutId: sid,
        },
      });
    }
    return order.id;
  }

  console.log("\n§5 the reaper retires orphans — and only orphans");

  const abandoned = await makeOrder("PENDING", ["cs_abandoned"]);
  check("an abandoned order is cancelled", (await reapExpiredCheckout(abandoned, "cs_abandoned")) === true);
  check(
    "…and its status really is CANCELLED",
    (await db.order.findUniqueOrThrow({ where: { id: abandoned } })).status === "CANCELLED",
  );
  check(
    "…its line items are VOID, not deleted",
    (await db.lineItem.findFirstOrThrow({ where: { orderId: abandoned } })).status === "VOID",
  );
  check(
    "…and its payment row is FAILED",
    (await db.payment.findFirstOrThrow({ where: { orderId: abandoned } })).status === "FAILED",
  );
  check("re-running on the same event changes nothing", (await reapExpiredCheckout(abandoned, "cs_abandoned")) === false);

  // THE ROW THIS SUITE EXISTS FOR. Resume mints a new session while the old one
  // is still winding down, so the old session's `expired` event lands while the
  // buyer is mid-payment on the new one. Cancelling on that event would kill the
  // order underneath them — and silently, because confirmOrderPaid claims on
  // `status: "PENDING"`, so their payment would then confirm nothing while the
  // charge was captured.
  const resumed = await makeOrder("PENDING", ["cs_old", "cs_new"]);
  check("an order with a live session is NOT cancelled", (await reapExpiredCheckout(resumed, "cs_old")) === false);
  check(
    "…the order stays PENDING",
    (await db.order.findUniqueOrThrow({ where: { id: resumed } })).status === "PENDING",
  );
  check(
    "…the expired session's row is FAILED",
    (await db.payment.findFirstOrThrow({ where: { orderId: resumed, stripeCheckoutId: "cs_old" } })).status === "FAILED",
  );
  check(
    "…the live session's row is untouched",
    (await db.payment.findFirstOrThrow({ where: { orderId: resumed, stripeCheckoutId: "cs_new" } })).status === "PENDING",
  );
  // And once the survivor expires too, the order does get reaped.
  check("…and reaping the last session then cancels it", (await reapExpiredCheckout(resumed, "cs_new")) === true);

  const paid = await makeOrder("CONFIRMED", ["cs_paid"]);
  check("a CONFIRMED order is never cancelled by an expiry", (await reapExpiredCheckout(paid, "cs_paid")) === false);
  check(
    "…and stays CONFIRMED",
    (await db.order.findUniqueOrThrow({ where: { id: paid } })).status === "CONFIRMED",
  );

  console.log("\n§6 resuming refuses anyone who cannot prove the order is theirs");

  const pending = await makeOrder("PENDING", []);
  const otherPending = await makeOrder("PENDING", []);

  const noProof = await resumeCheckoutForOrder(pending, null);
  check("no cookie ⇒ refused", noProof.ok === false && noProof.reason === "not-authorised");
  const wrongProof = await resumeCheckoutForOrder(pending, signResumeProof(otherPending));
  check("another order's cookie ⇒ refused", wrongProof.ok === false && wrongProof.reason === "not-authorised");
  const garbage = await resumeCheckoutForOrder(pending, `${pending}.garbage`);
  check("a forged MAC ⇒ refused", garbage.ok === false && garbage.reason === "not-authorised");

  // A valid MAC for an id that does not exist must be indistinguishable from a
  // bad MAC, or the endpoint becomes an existence oracle for order ids.
  const ghost = await resumeCheckoutForOrder("ord_does_not_exist", signResumeProof("ord_does_not_exist"));
  check(
    "a valid proof for a non-existent order is 'not-authorised', not 'not-resumable'",
    ghost.ok === false && ghost.reason === "not-authorised",
  );

  // Confirmed while they were away: back out, pay in the still-open tab, come
  // back, tap finish paying. A receipt, not an error.
  const confirmedResume = await resumeCheckoutForOrder(paid, signResumeProof(paid));
  check("a CONFIRMED order resumes to its receipt", confirmedResume.ok === true);
  if (confirmedResume.ok) {
    check("…flagged as already confirmed", confirmedResume.alreadyConfirmed === true);
    check("…pointing at the confirmation page", confirmedResume.url.endsWith(`/confirm/${paid}`), confirmedResume.url);
    check(
      "…with no leftover Stripe placeholder in the URL",
      !confirmedResume.url.includes("{CHECKOUT_SESSION_ID}"),
    );
    check("…and no fresh resume credential", confirmedResume.resumeProof === null);
  }
  const confirmedCustomRoute = await resumeCheckoutForOrder(paid, signResumeProof(paid), {
    successPath: `/perform/after-payment/${paid}`,
  });
  check(
    "…honouring the caller's success path, so the flow stays generic",
    confirmedCustomRoute.ok === true &&
      confirmedCustomRoute.url.endsWith(`/perform/after-payment/${paid}`),
  );

  const dead = await resumeCheckoutForOrder(abandoned, signResumeProof(abandoned));
  check("a CANCELLED order is not resumable", dead.ok === false && dead.reason === "not-resumable");

  console.log("\n§7 what the return page may read, and how hard resume is to grind");

  const visible = await getResumableCheckout(pending, signResumeProof(pending));
  check("a proven PENDING order exposes its total", visible?.amountCents === 2500, JSON.stringify(visible));
  check("…and no more than the total and the id", visible !== null && Object.keys(visible).sort().join(",") === "amountCents,orderId");
  check("an unproven order exposes nothing", (await getResumableCheckout(pending, null)) === null);
  check("a forged proof exposes nothing", (await getResumableCheckout(pending, `${pending}.xxxx`)) === null);
  check("a CONFIRMED order is not offered for resume", (await getResumableCheckout(paid, signResumeProof(paid))) === null);
  check("a CANCELLED order is not offered for resume", (await getResumableCheckout(abandoned, signResumeProof(abandoned))) === null);
  check("no ?cancelled= at all reads nothing", (await getResumableCheckout(undefined, signResumeProof(pending))) === null);

  // Functional half: a bucket really does stop at its limit.
  resetRateLimits();
  let refused = false;
  for (let i = 0; i < 11; i++) {
    try {
      await guardKey(`verify-resume-order:${pending}`, 10, 600);
    } catch {
      refused = true;
    }
  }
  check("a per-order bucket refuses the 11th attempt in the window", refused);
  let otherOk = true;
  try {
    await guardKey(`verify-resume-order:${otherPending}`, 10, 600);
  } catch {
    otherOk = false;
  }
  check("…without punishing a different order", otherOk);

  // Structural half, and the only source-level row in this file. The functional
  // check above proves guardKey works; it cannot prove the resume action USES
  // it. A per-IP bucket alone bounds one attacker and does nothing to bound
  // attempts against one order id, which is exactly what a guessed-cuid loop
  // spread over many addresses is doing. If that call is ever dropped "because
  // we already rate-limit resume", this is what goes red.
  const actionSrc = readFileSync("src/app/_components/checkout-action.ts", "utf8");
  check(
    "the resume action rate-limits on the order id, not only the IP",
    /guardKey\(\s*`resume-order:\$\{orderId\}`/.test(actionSrc),
  );

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§8 editing the form retracts the offer to pay the old total");

  // The rule this pins is about money: the resume button pays the EXISTING
  // order at the EXISTING price, so once the buyer edits anything, the form's
  // total and the order's total have diverged and the offer must be withdrawn.
  const settled = snapshot({ groupName: "Shakti Steps", participants: "8" });
  check(
    "an untouched restored form is not dirty",
    hasEdits(settled, { groupName: "Shakti Steps", participants: "8" }) === false,
  );
  check(
    "changing a field is dirty",
    hasEdits(settled, { groupName: "Shakti Steps", participants: "9" }) === true,
  );
  check(
    "clearing a field is dirty",
    hasEdits(settled, { groupName: "", participants: "8" }) === true,
  );
  // "Page has not settled yet" is NOT "no edits". Conflating the two is what
  // the structural rows below exist to catch.
  check("a null baseline is not dirty", hasEdits(null, { groupName: "x" }) === false);

  // Structural, for the same reason as §7's row: the pure function above cannot
  // prove the forms CALL it with a baseline that was actually set. The bug this
  // catches is specific and was live once — with a valid resume cookie but no
  // draft (the tab-loss path the cookie was added to serve), an early `return`
  // left the baseline null, so hasEdits could never fire and the button went on
  // offering the abandoned order's total over a form typed from scratch. Both
  // forms must set a baseline on the no-draft path too.
  for (const [label, file] of [
    ["perform", "src/app/perform/PerformanceEntryForm.tsx"],
    ["register", "src/app/register/RegisterForm.tsx"],
  ] as const) {
    const src = readFileSync(file, "utf8");
    check(
      `${label}: the no-draft path still sets a dirty baseline`,
      /if \(!draft\) \{[^}]*baseline\.current = snapshot\(values\);/s.test(src),
    );
    check(
      `${label}: the restored path baselines the APPLIED values, not the raw draft`,
      src.includes("baseline.current = snapshot(applied);"),
    );
  }

  await cleanup(org.id);
}

/** Remove everything this script creates (cascades don't cover payments/ledger). */
async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({ where: { orgId, code: CODE } });
  for (const event of events) {
    const orders = await db.order.findMany({ where: { eventId: event.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    await db.ledgerEntry.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.event.delete({ where: { id: event.id } });
  }
  await db.serviceType.deleteMany({ where: { orgId, key: SERVICE_KEY } });
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
