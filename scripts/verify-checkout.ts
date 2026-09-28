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
 *   §9  drop the isKnownOrder guard from the webhook       → foreign-order row fails
 *   §10 add "CAMP" to DETAIL_ALLOWED in src/lib/ga.ts     → every No-PHI row fails
 *   §10 make toDollars return Math.round(cents)           → dollars/cents rows fail
 *   §10 delete `if (!input.clientId) return null`          → cash-walk-in rows fail
 */
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  const { reapExpiredCheckout, resumeCheckoutForOrder, getResumableCheckout, isKnownOrder } =
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

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§9 a webhook for another deployment's order is acknowledged, not retried");

  // test.dcica.org and events.dcica.org share ONE Stripe account, so each
  // receives the other's events. Prod answered 5xx for orders it had never
  // heard of, Stripe retried on a permanent schedule, and four events wedged
  // until Stripe threatened to disable the endpoint (2026-08-21 → 08-24).
  check("an order in this deployment is known", (await isKnownOrder(pending)) === true);
  check("an order from another deployment is not", (await isKnownOrder("cmt0000notours0000000000")) === false);
  check("a cancelled order is still OURS — the guard is about ownership, not status",
    (await isKnownOrder(abandoned)) === true);

  // Structural, same reasoning as §7: the predicate above cannot prove the
  // route CONSULTS it. If the guard is dropped "because confirmOrderPaid throws
  // anyway", the retry storm comes straight back.
  const hookSrc = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
  check("the webhook consults isKnownOrder before acting",
    /if\s*\(!\(await isKnownOrder\(orderId\)\)\)/.test(hookSrc));
  check("…and answers 200 for a foreign order, never a 5xx",
    /order not in this deployment/.test(hookSrc) &&
      !/order not in this deployment[\s\S]{0,200}status:\s*5/.test(hookSrc));

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n§10 the GA4 purchase event reports money without reporting medicine");

  // THE ROW THIS SECTION EXISTS FOR is the first one below.
  //
  // A camp's ServiceType.name values are real clinical service names — "Vision
  // Screening", "Dental Check", "Bloodwork" (prisma/seed.ts). Sending those as
  // GA4 item names would pin a per-visitor record of which health services a
  // person bought to a persistent Google client_id: a breach of the platform's
  // No-PHI/HIT constraint, a contradiction of the promise already published in
  // docs/Privacy-Policy.md that no registration or payment data reaches
  // Analytics, and a violation of Google's own prohibition on health data that
  // can get a tenant's property terminated.
  //
  // Nothing at runtime would go red if that broke. The payload would send, GA4
  // would accept it, revenue would look right, and the leak would be visible
  // only inside Google's UI. So the assertion is made over the FULLY SERIALIZED
  // payload — the actual bytes — rather than over the items array, because a
  // service name smuggled into item_id, item_category, a param name, or a field
  // added later must fail this too.
  const ga = await import("../src/lib/ga");

  const CAMP_LINES = [
    { name: "Vision Screening", key: "vision", amountCents: 2500, quantity: 1 },
    { name: "Bloodwork", key: "bloodwork", amountCents: 1999, quantity: 3 },
  ];
  const campPayload = ga.buildPurchasePayload({
    clientId: "1234567890.1700000000",
    orderId: "ord_camp",
    eventType: "CAMP",
    eventSlug: "winter-camp-mc-2026w",
    paymentMethod: "STRIPE",
    lineItems: CAMP_LINES,
  });
  const campJson = JSON.stringify(campPayload);
  for (const forbidden of ["Vision Screening", "Bloodwork", "vision", "bloodwork"]) {
    check(
      `a CAMP payload contains no trace of "${forbidden}"`,
      !campJson.includes(forbidden),
      campPayload?.events[0].params.items.map((i) => i.item_name).join("|"),
    );
  }
  check(
    "…because the whole order collapses to ONE generic line",
    campPayload?.events[0].params.items.length === 1,
  );
  check(
    "…named for the registration, not the service",
    campPayload?.events[0].params.items[0].item_name === ga.REDACTED_ITEM_NAME,
  );
  check(
    "…still carrying the total unit count, so item volume is not lost",
    campPayload?.events[0].params.items[0].quantity === 4,
    String(campPayload?.events[0].params.items[0].quantity),
  );

  // Fail closed. CAMP is not the only redacted case: an event type that is
  // absent, null, or an enum member added after this file was written must
  // redact too, so adding a fourth EventType cannot leak by omission. The
  // allowlist direction is the whole safety property.
  for (const [label, type] of [
    ["null", null],
    ["undefined", undefined],
    ["an unrecognised enum member", "SOME_FUTURE_TYPE"],
    ["lower-case camp (not a real member)", "camp"],
  ] as const) {
    const p = ga.buildPurchasePayload({
      clientId: "1.2",
      orderId: "ord_x",
      eventType: type,
      eventSlug: null,
      paymentMethod: "CASH",
      lineItems: CAMP_LINES,
    });
    check(
      `${label} as an event type redacts as if it were CAMP`,
      !JSON.stringify(p).includes("Bloodwork") &&
        p?.events[0].params.items.length === 1,
    );
  }

  // The other half of the property: the redaction must be CONDITIONAL. A
  // blanket "never send item names" would pass every row above while quietly
  // destroying the merchandise and membership reporting this change exists to
  // create, and nothing would notice.
  const generalPayload = ga.buildPurchasePayload({
    clientId: "1234567890.1700000000",
    orderId: "ord_general",
    eventType: "GENERAL",
    eventSlug: "dandiya-night-dn-2026",
    paymentMethod: "STRIPE",
    lineItems: [
      { name: "Garba Pass", key: "garba-pass", amountCents: 2500, quantity: 2 },
      { name: "Dandiya Sticks", key: "sticks", amountCents: 500, quantity: 1 },
    ],
  });
  const generalJson = JSON.stringify(generalPayload);
  check("a GENERAL payload DOES name its items", generalJson.includes("Garba Pass"));
  check("…all of them, not just the first", generalJson.includes("Dandiya Sticks"));
  check("…one item per line", generalPayload?.events[0].params.items.length === 2);
  check(
    "…with per-unit prices in dollars and the real quantities",
    generalPayload?.events[0].params.items[0].price === 25 &&
      generalPayload?.events[0].params.items[0].quantity === 2,
  );
  const memberPayload = ga.buildPurchasePayload({
    clientId: "1.2",
    orderId: "ord_mem",
    eventType: "MEMBERSHIP_DRIVE",
    eventSlug: null,
    paymentMethod: "CHECK",
    lineItems: [{ name: "Family 2-year", key: "family-2yr", amountCents: 10000, quantity: 1 }],
  });
  check(
    "a MEMBERSHIP_DRIVE payload names its terms too",
    JSON.stringify(memberPayload).includes("Family 2-year"),
  );

  // Cents → dollars. The DB stores integer cents; GA4 reads `value` as a
  // decimal currency amount, so shipping cents would inflate every reported
  // sale by 100× and make the conversion-value numbers worse than absent.
  // 2500×1 + 1999×3 = 8497 cents.
  check(
    "value is DOLLARS, not cents",
    campPayload?.events[0].params.value === 84.97,
    String(campPayload?.events[0].params.value),
  );
  check("currency is stated explicitly", campPayload?.events[0].params.currency === "USD");
  check(
    "transaction_id is the order id — GA4's dedupe key, so the webhook and the confirm page cannot double-count",
    campPayload?.events[0].params.transaction_id === "ord_camp",
  );
  check("the event is named purchase", campPayload?.events[0].name === "purchase");
  check(
    "the custom dimensions are all present",
    campPayload?.events[0].params.event_slug === "winter-camp-mc-2026w" &&
      campPayload?.events[0].params.event_kind === "CAMP" &&
      campPayload?.events[0].params.payment_method === "STRIPE",
  );
  check(
    "a quantity-aware line total is amountCents × quantity",
    ga.buildPurchasePayload({
      clientId: "1.2",
      orderId: "o",
      eventType: "GENERAL",
      eventSlug: null,
      paymentMethod: "CASH",
      lineItems: [{ name: "Pass", amountCents: 1000, quantity: 5 }],
    })?.events[0].params.value === 50,
  );

  // A cash walk-in has no web session of their own — the till volunteer's
  // browser is not the buyer's — so there is no client_id and NO event is sent.
  // Synthesizing one would invent phantom Direct traffic and pin a morning's
  // worth of sales on one "visitor", corrupting the channel attribution this is
  // all for. Reconciliation, not GA, is the source of truth for money.
  for (const [label, id] of [
    ["a null", null],
    ["an empty-string", ""],
  ] as const) {
    check(
      `${label} client id produces NO payload at all`,
      ga.buildPurchasePayload({
        clientId: id,
        orderId: "ord_cash",
        eventType: "GENERAL",
        eventSlug: null,
        paymentMethod: "CASH",
        lineItems: CAMP_LINES,
      }) === null,
    );
  }
  // …and the sender agrees, without touching the network. Either skip reason is
  // acceptable — which one you get depends on whether the ambient .env happens
  // to configure GA — but neither may be a request.
  const sendResult = await ga.sendPurchaseEvent({
    clientId: null,
    orderId: "ord_cash",
    eventType: "GENERAL",
    eventSlug: null,
    paymentMethod: "CASH",
    lineItems: CAMP_LINES,
  });
  check(
    "sendPurchaseEvent skips a null client id rather than posting",
    sendResult === "skipped-no-client-id" || sendResult === "skipped-unconfigured",
    sendResult,
  );

  // Both halves required, default off: this is open-source software a stranger
  // self-hosts, and nobody may be made to configure Google anything to take a
  // payment. The measurement id alone is worse than nothing — the Measurement
  // Protocol discards a request with no api_secret, which looks exactly like
  // analytics that works.
  check("configured needs BOTH the id and the secret", ga.gaConfigured("G-ABC123", "s") === true);
  check("…an id with no secret is not configured", ga.gaConfigured("G-ABC123", undefined) === false);
  check("…a secret with no id is not configured", ga.gaConfigured(undefined, "s") === false);
  check("…and neither is nothing at all", ga.gaConfigured(undefined, undefined) === false);

  // The client id is the `<a>.<b>` TAIL of the `_ga` cookie, not the cookie.
  // Sending "GA1.1.123.456" attributes the event to nothing at all, silently.
  check("the _ga cookie yields its client id tail", ga.parseGaCookie("GA1.1.123.456") === "123.456");
  check("…including an older domain-depth digit", ga.parseGaCookie("GA1.2.987.654") === "987.654");
  check("a malformed cookie yields null, not a garbage id", ga.parseGaCookie("GA1.1.123") === null);
  check("an empty cookie yields null", ga.parseGaCookie("") === null);
  check("a missing cookie yields null", ga.parseGaCookie(undefined) === null);

  // The column exists and is nullable — the additive-first half of this change.
  // Prisma SELECTs every declared column, so had the migration not landed
  // before the field was declared, every read of `orders` above would already
  // have faulted with P2022 (the /register outage of 2026-08-21).
  const gaOrder = await makeOrder("PENDING", []);
  check(
    "Order.gaClientId defaults to null, which is a permanent legitimate value",
    (await db.order.findUniqueOrThrow({ where: { id: gaOrder } })).gaClientId === null,
  );
  await db.order.update({ where: { id: gaOrder }, data: { gaClientId: "111.222" } });
  check(
    "…and round-trips when a web checkout did capture one",
    (await db.order.findUniqueOrThrow({ where: { id: gaOrder } })).gaClientId === "111.222",
  );

  // Structural, same reasoning as §7 and §9: the pure function above cannot
  // prove the money path CALLS it, and it certainly cannot prove where. Both
  // properties below are invisible at runtime if broken — the first would
  // double-count every sale the confirm page and the webhook both reach, the
  // second would put a Google round-trip inside the confirmation transaction,
  // where a slow endpoint holds a DB lock on the money path.
  const paySrc = readFileSync("src/server/payments.ts", "utf8");
  const sendAt = paySrc.indexOf("sendPurchaseEvent({");
  const guardAt = paySrc.indexOf("if (!result.alreadyConfirmed)");
  const thenAt = paySrc.indexOf(".then(async (result)");
  check("confirmOrderPaid sends the purchase event", sendAt > 0);
  check(
    "…exactly once, so there is one hook and not two",
    paySrc.split("sendPurchaseEvent({").length - 1 === 1,
  );
  check(
    "…under the same !alreadyConfirmed guard as the email, so only the winner of the atomic claim reports",
    guardAt > 0 && sendAt > guardAt,
  );
  check(
    "…and outside the transaction, so Google cannot hold a DB lock",
    thenAt > 0 && sendAt > thenAt,
  );
  check(
    "the client id is captured in openCheckoutSession — the one path every checkout takes",
    /async function openCheckoutSession[\s\S]*?readGaClientId\(\)[\s\S]*?\n\}/.test(paySrc),
  );
  check(
    "…and a missing request context yields null rather than throwing on the money path",
    /catch \{\s*return null;\s*\}\s*\}\s*\n\s*\/\*\* Mint the Stripe session/.test(paySrc),
  );

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

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§X confirmOrderPaid budgets for a big party");
  // Read AS TEXT: this is about the transaction OPTIONS, which no amount
  // of calling the function proves unless the box happens to be slow.
  //
  // campId assignment cannot be batched -- every attendee gets a different
  // random token -- so a party of N costs N uniqueness SELECTs plus N
  // UPDATEs, sequentially, inside ONE transaction. Prisma's default budget
  // is 5s. Measured against the deployed test DB on 2026-09-28: a party of
  // 4 took 6969ms and a party of 10 took 10203ms. Both rolled back, and the
  // rollback is the expensive part -- Stripe has the money, the webhook
  // 500s, the order sits PENDING with no ticket.
  const pay = readFileSync(
    join(process.cwd(), "src/server/payments.ts"),
    "utf8",
  );
  const confirmIdx = pay.indexOf("export async function confirmOrderPaid");
  check("confirmOrderPaid exists where expected", confirmIdx > -1);
  // Bounded by the NEXT top-level export, not by a character count. The
  // options sit after a ~275-line transaction body, and a fixed window that
  // happened to stop short read as "no timeout set" — a check that fails for
  // the wrong reason is only marginally better than one that cannot fail.
  const afterConfirm = pay.indexOf("\nexport ", confirmIdx + 1);
  const confirmBody = pay.slice(
    confirmIdx,
    afterConfirm > -1 ? afterConfirm : pay.length,
  );
  const m = confirmBody.match(/timeout:\s*([0-9_]+)/);
  const budget = m ? Number(m[1].replace(/_/g, "")) : 0;
  check("its transaction sets an explicit timeout, not the 5s default",
    budget > 0, String(budget));
  // 10203ms is the measured worst case seen so far. A budget at or under
  // it would have failed that exact order, so the floor is set above it
  // rather than at a round number that merely looks generous.
  check("...and the budget clears the measured worst case (10203ms)",
    budget > 10_203, String(budget));
  check("maxWait is set too, so a busy pool waits rather than throwing",
    /maxWait:\s*[0-9_]+/.test(confirmBody));

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
