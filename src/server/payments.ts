import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import {
  buildCheckoutReturn,
  type CheckoutRoutes,
} from "@/lib/checkoutReturn";
import { signResumeProof, verifyResumeProof } from "@/lib/checkoutResume";
import { sendConfirmationEmail } from "@/lib/email";
import { newCampId } from "@/lib/campId";
import { log } from "@/lib/logger";

/**
 * The single PaymentService (locked decision #6). Every billable thing is a
 * LineItem; one ledger table records money movement. Confirmation is the ONLY
 * place an order becomes CONFIRMED — invoked by the Stripe webhook (decision #2,
 * webhook-authoritative) or by a till holder recording cash. It is idempotent
 * and does the cap decrement atomically at the DB (not app-layer).
 */

export class OverCapacityError extends Error {
  constructor(public serviceKey: string) {
    super(`Service "${serviceKey}" is at capacity`);
    this.name = "OverCapacityError";
  }
}

/**
 * The service has NO cap row for this event at all — a configuration fault, not
 * a sold-out service. Kept distinct from OverCapacityError because the two need
 * opposite handling: a full cap is an expected, staff-handled outcome (the buyer
 * paid, staff refunds), while a missing row means the event was never fully
 * configured and every purchase of that service will fail. Collapsing the two
 * is exactly what hid a lost $61 order for a day — the webhook logged "over
 * capacity" for a cap sitting at 23/40.
 */
export class MissingCapError extends Error {
  constructor(public serviceKey: string) {
    super(`No capacity row configured for service "${serviceKey}"`);
    this.name = "MissingCapError";
  }
}

/**
 * What a caller must do with a freshly-minted Checkout session.
 *
 * `resumeProof` is not optional housekeeping. It is the cookie value that lets
 * this buyer come back and finish paying after backing out, and the only place
 * it can be set is the request that is about to redirect them. Every caller
 * hands it to setResumeCookie(). Returning it as part of a required shape is
 * what makes forgetting it visible at the call site rather than six weeks later
 * in a support thread.
 */
export type CheckoutHandoff = {
  url: string;
  resumeProof: string | null;
};

/** Line-item total, quantity-aware. Must match what confirmOrderPaid records. */
function orderTotalCents(
  lineItems: { amountCents: number; quantity: number }[],
): number {
  return lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
}

/**
 * Create a Stripe hosted Checkout session for a PENDING order (decision #7:
 * hosted Checkout, no native build). For a $0 order there's nothing to charge —
 * caller should confirm directly instead.
 *
 * Callers pass BASE PATHS only. The return-URL query contract — always
 * `cancelled=<orderId>`, plus `event=` when the order has one — belongs to
 * buildCheckoutReturn, so that no payment flow can ship without it. See
 * src/lib/checkoutReturn.ts for why that was worth centralising.
 */
export async function createCheckoutForOrder(
  orderId: string,
  routes?: CheckoutRoutes,
): Promise<CheckoutHandoff> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lineItems: true, event: true },
  });

  // Quantity-aware: a qty-5 merch line costs 5 × the unit price. Must match the
  // total confirmOrderPaid records, or Stripe under-collects and the ledger and
  // the charge disagree (only bites quantity-mode events — camps are all qty 1).
  const totalCents = orderTotalCents(order.lineItems);
  if (totalCents === 0) {
    throw new Error("Order total is $0 — confirm directly, no checkout needed.");
  }
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }

  const session = await openCheckoutSession(order, totalCents, routes);
  return { url: session.url, resumeProof: signResumeProof(order.id) };
}

export type ResumeOutcome =
  | { ok: true; url: string; alreadyConfirmed: boolean; resumeProof: string | null }
  | { ok: false; reason: "not-authorised" | "not-resumable" };

/**
 * Re-open Checkout on an order the buyer already created, so backing out of
 * Stripe costs them a tap rather than the whole form.
 *
 * `proof` is the checkout_resume cookie value, passed in rather than read from
 * next/headers here — that keeps this callable from scripts/verify-checkout.ts
 * and keeps request plumbing in the action layer.
 *
 * CAPACITY IS NOT RE-CHECKED, matching the rest of the system: caps decrement
 * atomically at confirmation, never at checkout creation (see confirmOrderPaid
 * below). An hour-long resume window does make "sold out while you were away"
 * more likely than it was, and it lands in the state that is already accepted
 * elsewhere — the buyer pays, OverCapacityError is logged, the webhook 200s,
 * and staff refunds. Do not bolt a capacity check on here without deciding what
 * the buyer sees, because refusing at this point strands an order they can
 * neither pay for nor walk away from.
 */
export async function resumeCheckoutForOrder(
  orderId: string,
  proof: string | null | undefined,
  routes?: CheckoutRoutes,
): Promise<ResumeOutcome> {
  // Authorisation BEFORE any database read. This ordering is the whole defence
  // against ?cancelled= becoming a PII oracle: an unauthorised caller must not
  // be able to distinguish a real order id from a fabricated one, and the only
  // way to guarantee that is to not look one up.
  if (!verifyResumeProof(orderId, proof)) {
    return { ok: false, reason: "not-authorised" };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { lineItems: true, event: true },
  });
  // A valid MAC for an id that no longer exists is still nothing this caller
  // may learn about, so it gets the same answer as a bad MAC.
  if (!order) return { ok: false, reason: "not-authorised" };

  const { successUrl } = buildCheckoutReturn(order, env.NEXT_PUBLIC_APP_URL, routes);

  // Confirmed while they were away. The sequence is ordinary: back out of
  // Checkout, pay in the tab that is still open, come back, tap "finish
  // paying". That is a success, not an error, and the honest answer is their
  // receipt. The session_id placeholder is stripped because Stripe is not the
  // one substituting it on this path.
  if (order.status === "CONFIRMED") {
    return {
      ok: true,
      alreadyConfirmed: true,
      url: successUrl.replace("?session_id={CHECKOUT_SESSION_ID}", ""),
      resumeProof: null,
    };
  }
  if (order.status !== "PENDING") {
    return { ok: false, reason: "not-resumable" };
  }

  const totalCents = orderTotalCents(order.lineItems);
  if (totalCents === 0) return { ok: false, reason: "not-resumable" };
  if (!stripe) return { ok: false, reason: "not-resumable" };

  const session = await openCheckoutSession(order, totalCents, routes);

  // ── ORDERING IS LOAD-BEARING: create the new session, THEN expire the old ──
  //
  // The webhook's checkout.session.expired handler cancels an order only when
  // no PENDING payment row remains. Expiring first would open a window in which
  // the old session's `expired` event arrives, finds no live session, and
  // CANCELS an order the buyer is at that moment paying for — and because
  // confirmOrderPaid claims on `status: "PENDING"`, that cancellation would
  // make the subsequent payment confirm nothing while the charge is captured.
  // This order guarantees at least one live PENDING payment row at all times.
  //
  // THE COST, STATED PLAINLY: between these two calls both sessions are
  // payable. confirmOrderPaid guarantees one CONFIRMATION, not one CAPTURE, so
  // a buyer who pays in both tabs is charged twice and needs a manual refund.
  // The window is small and this is the better trade — the reverse ordering
  // turns a rare double charge into a routine dead order — but it is real and
  // it is not closed. Do not describe it as fixed.
  await expireOtherPendingSessions(order.id, session.id);

  return {
    ok: true,
    alreadyConfirmed: false,
    url: session.url,
    resumeProof: signResumeProof(order.id),
  };
}

/**
 * What the cancel-return page may safely show about the order Stripe just sent
 * the buyer back from.
 *
 * Returns null for anything the caller has not proved it owns, and — crucially —
 * returns null identically for "bad proof" and "no such order", so the page
 * cannot be used to test whether an order id exists.
 *
 * Only the total is exposed. The page has no need for the registrant's name,
 * email or phone, so they are not selected: the buyer's own draft refills the
 * form, and the amount is the one fact that must come from the server because a
 * stale one would misprice a payment button.
 */
export async function getResumableCheckout(
  orderId: string | undefined,
  proof: string | null | undefined,
): Promise<{ orderId: string; amountCents: number } | null> {
  if (!orderId) return null;
  if (!verifyResumeProof(orderId, proof)) return null;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      lineItems: { select: { amountCents: true, quantity: true } },
    },
  });
  if (!order || order.status !== "PENDING") return null;

  return { orderId: order.id, amountCents: orderTotalCents(order.lineItems) };
}

/**
 * An abandoned checkout has run out of time. Retire the dead session and, if
 * this order has nothing else in flight, retire the order with it.
 *
 * Returns true when the ORDER was cancelled (as opposed to just the payment row
 * being retired), which is what the webhook reports back to Stripe.
 *
 * ── THE GUARD ON STEP 2 IS THE WHOLE FUNCTION ──
 * An order can legitimately have more than one Stripe session: resuming mints a
 * fresh one while the abandoned one is still winding down
 * (resumeCheckoutForOrder, above). The `expired` event for the OLD session then
 * arrives while the buyer is mid-payment on the NEW one. Cancelling on that
 * event alone would kill their order underneath them — and worse, silently:
 * confirmOrderPaid claims on `status: "PENDING"`, so their payment would land,
 * match zero rows, report `alreadyConfirmed`, and leave a captured charge
 * attached to a cancelled order with no campId, no QR and no email.
 *
 * So the order is cancelled only when NO live session remains. "Live" is read
 * off the Payment rows, which is why expireOtherPendingSessions is careful to
 * mark superseded rows FAILED rather than leaving them PENDING.
 *
 * Idempotent: a Stripe retry re-runs it, finds the payment already FAILED and
 * the order already CANCELLED, and changes nothing.
 */
export async function reapExpiredCheckout(
  orderId: string,
  checkoutSessionId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // 1. This session is dead. Retire its payment row first, so the liveness
    //    test below cannot count the very session that just expired.
    await tx.payment.updateMany({
      where: { orderId, stripeCheckoutId: checkoutSessionId, status: "PENDING" },
      data: { status: "FAILED" },
    });

    // 2. Anything else still payable on this order? A resumed order has one.
    const live = await tx.payment.count({
      where: { orderId, status: "PENDING" },
    });
    if (live > 0) return false;

    // Conditional UPDATE, matching the atomic-claim idiom confirmOrderPaid
    // uses: PENDING is re-checked at write time, so an order confirmed by a
    // concurrent webhook between the count above and this statement is not
    // clobbered. This is the statement that must never win a race with a
    // payment, hence the belt of the status filter and the braces of step 2.
    const cancelled = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count > 0) {
      // VOID rather than delete: the line items are what a coordinator reads to
      // understand what someone tried to buy and did not.
      await tx.lineItem.updateMany({
        where: { orderId, status: "PENDING_PAYMENT" },
        data: { status: "VOID" },
      });
    }
    return cancelled.count > 0;
  });
}

/** Mint the Stripe session and record its PENDING Payment row. Shared by create and resume. */
async function openCheckoutSession(
  order: {
    id: string;
    orgId: string;
    eventId: string;
    registrantEmail: string;
    lineItems: { description: string; amountCents: number; quantity: number }[];
  },
  totalCents: number,
  routes?: CheckoutRoutes,
): Promise<{ id: string; url: string }> {
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }

  const { successUrl, cancelUrl, expiresAt } = buildCheckoutReturn(
    order,
    env.NEXT_PUBLIC_APP_URL,
    routes,
  );

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Without this a session lives 24 hours, which is why abandoned orders
    // accumulated without bound: checkout.session.expired is what reaps them
    // and it never fired inside any window anyone was looking at. See
    // CHECKOUT_TTL_SECONDS for why this is an hour, not Stripe's 30-minute floor.
    expires_at: expiresAt,
    customer_email: order.registrantEmail,
    // Webhook reads this to confirm the right order (decision #2).
    metadata: { orderId: order.id, orgId: order.orgId },
    // Comped ($0) lines are omitted — Stripe's hosted page is the payment
    // receipt, and our own /confirm page shows the full breakdown including
    // comps. Sending them would also risk a zero-amount line-item rejection.
    line_items: order.lineItems
      .filter((li) => li.amountCents > 0)
      .map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: "usd",
          unit_amount: li.amountCents,
          product_data: { name: li.description },
        },
      })),
  });

  await db.payment.create({
    data: {
      orgId: order.orgId,
      orderId: order.id,
      method: "STRIPE",
      status: "PENDING",
      amountCents: totalCents,
      stripeCheckoutId: session.id,
    },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url };
}

/**
 * Close every other still-open session on this order, so only the newest can be
 * paid, and drop its Payment row to FAILED.
 *
 * Best-effort by design: Stripe throws when a session is already complete or
 * already expired, and neither is a reason to fail the resume a buyer is
 * waiting on. The expires_at ceiling is the backstop for anything missed here.
 *
 * Marking the row FAILED is not cosmetic — the webhook's reaper reads exactly
 * this set to decide whether an order still has a live session, so a row left
 * PENDING against a dead session would keep an abandoned order alive forever.
 */
async function expireOtherPendingSessions(
  orderId: string,
  keepSessionId: string,
): Promise<void> {
  const stale = await db.payment.findMany({
    where: {
      orderId,
      status: "PENDING",
      method: "STRIPE",
      stripeCheckoutId: { not: null },
      NOT: { stripeCheckoutId: keepSessionId },
    },
    select: { id: true, stripeCheckoutId: true },
  });

  for (const payment of stale) {
    try {
      if (stripe && payment.stripeCheckoutId) {
        await stripe.checkout.sessions.expire(payment.stripeCheckoutId);
      }
    } catch (err) {
      log.warn("resume: could not expire superseded checkout session", {
        orderId,
        checkoutId: payment.stripeCheckoutId,
        err,
      });
    }
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });
  }
}

/**
 * Confirm a PENDING order from the Stripe Checkout session the browser was
 * redirected with. Returns true if the order is CONFIRMED afterwards.
 *
 * WHY THIS EXISTS: Stripe redirects the browser the instant Checkout succeeds,
 * and the webhook — the authoritative confirmer — is a separate async POST that
 * usually loses that race. Any page a buyer lands on straight after paying must
 * therefore be able to confirm synchronously. confirmOrderPaid is idempotent and
 * atomically claimed, so whichever path wins, the other is a no-op (and only the
 * winner sends the email).
 *
 * Extracted from the confirmation page when the performance-entry flow added a
 * SECOND post-payment landing page. Two copies of this would be two chances to
 * get the "session must belong to THIS order" guard wrong.
 */
export async function confirmFromCheckoutSession(
  orderId: string,
  sessionId: string | undefined,
): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });
  if (!order) return false;
  if (order.status === "CONFIRMED") return true;
  if (!sessionId || !stripe) return false;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    // The session must actually be paid AND belong to THIS order
    // (metadata.orderId is set when we create it) — never confirm an order from
    // a session id pasted in from elsewhere.
    if (
      session.payment_status !== "paid" ||
      session.metadata?.orderId !== order.id
    ) {
      return false;
    }
    await confirmOrderPaid(order.id, {
      method: "STRIPE",
      stripeCheckoutId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
      idempotencyKey: `checkout-${session.id}`,
    });
    return true;
  } catch (err) {
    // A genuinely-full cap stays quiet by design: the buyer paid, staff handles
    // the refund, and the caller falls through to its pending state. A MISSING
    // cap row is a different animal — a misconfigured event where every purchase
    // of that service fails — so it is logged at error rather than swallowed
    // with the sold-out case. The webhook remains the backstop either way.
    if (err instanceof MissingCapError) {
      log.error("confirm: service cap row missing (misconfigured event)", {
        orderId,
        serviceKey: err.serviceKey,
      });
    } else if (!(err instanceof OverCapacityError)) {
      log.error("confirm: stripe session verify failed", { orderId, err });
    }
    return false;
  }
}

type ConfirmInput = {
  method: "STRIPE" | "CASH" | "ZELLE" | "CHECK";
  stripePaymentIntentId?: string;
  stripeCheckoutId?: string;
  /** Guards against double-processing on webhook retries (decision #2). */
  idempotencyKey: string;
  cashTenderedCents?: number;
};

/**
 * Confirm a paid order. Idempotent: a retry with the same idempotencyKey, or an
 * order already CONFIRMED, is a no-op. Runs as one transaction:
 *   atomic cap decrement → assign campIds → mark paid → ledger → build route.
 */
export async function confirmOrderPaid(
  orderId: string,
  input: ConfirmInput,
): Promise<{ alreadyConfirmed: boolean; campIds: string[] }> {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lineItems: { include: { serviceType: true } },
        attendees: true,
        event: { include: { stations: { where: { active: true } } } },
      },
    });

    // Atomic claim (idempotency + concurrency guard). Exactly one caller may
    // transition PENDING → CONFIRMED. The Stripe webhook, the Checkout success
    // page (synchronous verify), and a cash till can all race to confirm the
    // same order; this conditional UPDATE is the lock — Postgres re-checks the
    // WHERE after any concurrent writer commits, so the loser matches 0 rows.
    // count === 0 means the order was already confirmed (or never pending) → no-op.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: { status: "CONFIRMED", method: input.method },
    });
    if (claim.count === 0) {
      return {
        alreadyConfirmed: true,
        campIds: order.attendees.map((a) => a.campId).filter(Boolean) as string[],
      };
    }

    // ── Atomic capacity decrement (DB-enforced, not app-layer) ──
    const counts = new Map<string, number>(); // serviceTypeId -> qty
    for (const li of order.lineItems) {
      if (li.serviceTypeId) {
        // quantity-aware: a qty-3 admission line consumes 3 cap units.
        counts.set(li.serviceTypeId, (counts.get(li.serviceTypeId) ?? 0) + li.quantity);
      }
    }
    for (const [serviceTypeId, qty] of counts) {
      const serviceKey =
        order.lineItems.find((li) => li.serviceTypeId === serviceTypeId)
          ?.serviceType?.key ?? serviceTypeId;

      // NEVER express this as $executeRaw / $queryRaw. An unqualified table name
      // in raw SQL resolves through the session's `search_path`, and Supabase's
      // transaction pooler does NOT reliably apply the connection string's
      // `?schema=` to every pooled backend: measured on the deployed test DB,
      // 5 of 24 pooled sessions reported `search_path = pg_catalog, public,
      // extensions` with no `test` in it. A raw `UPDATE service_caps` then hit
      // `public.service_caps`, matched nothing, and threw OverCapacityError on a
      // cap that was 23/40 — rolling back the whole confirmation, so a PAID
      // order silently reverted to PENDING (~1 in 5 confirmations). `prod` is a
      // named schema too, so the same coin flip applied to real money. Prisma
      // model operations always emit the schema explicitly
      // (UPDATE "test"."service_caps"), so the schema comes from the datasource
      // and cannot be lost. That is the entire point of this block.
      const cap = await tx.serviceCap.findUnique({
        where: { eventId_serviceTypeId: { eventId: order.eventId, serviceTypeId } },
        select: { capacity: true },
      });
      // No row at all ⇒ misconfigured event, not a sold-out service.
      if (!cap) throw new MissingCapError(serviceKey);

      // GUARANTEED: two concurrent confirmations cannot oversell. updateMany
      // compiles to ONE conditional UPDATE, so under READ COMMITTED Postgres
      // re-evaluates `sold <= capacity - qty` against the committed row version
      // after any concurrent writer commits, and two claims on the last seat
      // cannot both match. That is the property the old raw statement had, and
      // it is preserved.
      //
      // NOT guaranteed: `capacity` is read one statement earlier (Prisma cannot
      // compare column-to-column with arithmetic), so a coordinator LOWERING the
      // cap inside that window lets one already in-flight order commit against
      // the pre-edit limit — measured sold=33 against capacity=25. Accepted
      // deliberately: the same end state is already reachable through the admin
      // action's own unlocked read-then-write of `sold`
      // (src/app/admin/camps/[id]/services/actions.ts), nothing enforces
      // sold <= capacity at the DB, and one extra paid seat beats rejecting a
      // paid order. The durable fix is a CHECK ("sold" <= "capacity") constraint
      // plus catching the violation; that needs a migration, so it is a later
      // task — and it is NOT a licence to go back to $executeRaw (see above).
      const claimed = await tx.serviceCap.updateMany({
        where: {
          eventId: order.eventId,
          serviceTypeId,
          // capacity null = UNCAPPED, so there is no ceiling to test and every
          // claim succeeds. This is the reason capacity became nullable: it used
          // to be a plain Int where 0 meant "cannot sell", and an offered
          // service left at 0 charged the buyer and then failed right here
          // (`sold <= 0 - 1` matches nothing). A DB CHECK now refuses 0, so the
          // only two states left are "uncapped" and "a real ceiling".
          ...(cap.capacity === null ? {} : { sold: { lte: cap.capacity - qty } }),
        },
        data: { sold: { increment: qty } },
      });
      // With the schema no longer in play, count === 0 has exactly one honest
      // meaning left: the cap is genuinely full.
      if (claimed.count === 0) throw new OverCapacityError(serviceKey);
    }

    // ── Assign campIds (random tokens, not a sequence) ──
    // Event.nextCampSeq is deliberately no longer incremented: the sequence was
    // a published sales figure on every badge. See src/lib/publicId.ts.
    //
    // Tokens are drawn, then checked against the ids already stored, and any
    // that clash are redrawn. At 40 bits this loop effectively never runs a
    // second pass — it is here so that the id stays unique by construction
    // rather than by optimism.
    //
    // A collision with a CONCURRENT transaction still can't be seen from
    // inside this one and would surface as a unique-constraint violation that
    // aborts the confirmation. That is the correct failure: this runs from the
    // Stripe webhook, which retries, and confirmOrderPaid is idempotent — so
    // the retry re-runs with fresh tokens and succeeds. Nobody loses a paid
    // order, and no id is ever quietly reused.
    const ev = await tx.event.findUniqueOrThrow({
      where: { id: order.eventId },
      select: { code: true },
    });

    const campIds: string[] = [];
    const claimed = new Set<string>();
    for (const att of order.attendees) {
      let campId = newCampId(ev.code);
      for (let attempt = 0; attempt < 5; attempt++) {
        const taken =
          claimed.has(campId) ||
          (await tx.attendee.findUnique({
            where: { campId },
            select: { id: true },
          })) !== null;
        if (!taken) break;
        campId = newCampId(ev.code);
      }
      claimed.add(campId);
      campIds.push(campId);
      await tx.attendee.update({
        where: { id: att.id },
        data: { campId },
      });

      // ── One stored route per attendee (decision #5) ──
      for (const station of order.event.stations) {
        await tx.stationVisit.create({
          data: {
            attendeeId: att.id,
            stationId: station.id,
            sequence: station.sequence,
            status: "QUEUED",
          },
        });
      }
    }

    // ── Mark line items paid (order status already claimed above) ──
    await tx.lineItem.updateMany({
      where: { orderId: order.id },
      data: { status: "PAID" },
    });

    // ── Family membership: created/extended ONLY here, on confirmed payment ──
    // Previously done at cart creation, which let an abandoned PENDING order
    // mint a real (non-purgeable) membership term for free. Confirmation is the
    // authoritative step (decision #2), so the upsert belongs in this transaction.
    const membershipLine = order.lineItems.find((li) => li.membershipPlanId);
    if (membershipLine?.membershipPlanId) {
      const plan = await tx.membershipPlan.findUnique({
        where: { id: membershipLine.membershipPlanId },
      });
      if (plan) {
        const existing = await tx.member.findUnique({
          where: {
            orgId_email: { orgId: order.orgId, email: order.registrantEmail },
          },
        });
        // Extend from the later of now / current expiry (renewal stacks).
        const base =
          existing && existing.validTo > now ? existing.validTo : now;
        const validTo = new Date(base);
        validTo.setFullYear(validTo.getFullYear() + plan.termYears);

        await tx.member.upsert({
          where: {
            orgId_email: { orgId: order.orgId, email: order.registrantEmail },
          },
          update: {
            name: order.registrantName,
            phone: order.registrantPhone,
            planId: plan.id,
            partySize: plan.partySize,
            validTo,
          },
          create: {
            orgId: order.orgId,
            name: order.registrantName,
            email: order.registrantEmail,
            phone: order.registrantPhone,
            planId: plan.id,
            partySize: plan.partySize,
            validFrom: now,
            validTo,
          },
        });
      }
    }

    const totalCents = order.lineItems.reduce(
      (s, li) => s + li.amountCents * li.quantity,
      0,
    );

    // ── Record/settle the payment + ledger (decision #6) ──
    const existing = input.stripeCheckoutId
      ? await tx.payment.findUnique({
          where: { stripeCheckoutId: input.stripeCheckoutId },
        })
      : null;

    const payment = existing
      ? await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: "SUCCEEDED",
            stripePaymentIntentId: input.stripePaymentIntentId,
            idempotencyKey: input.idempotencyKey,
            cashTenderedCents: input.cashTenderedCents,
          },
        })
      : await tx.payment.create({
          data: {
            orgId: order.orgId,
            orderId: order.id,
            method: input.method,
            status: "SUCCEEDED",
            amountCents: totalCents,
            stripePaymentIntentId: input.stripePaymentIntentId,
            idempotencyKey: input.idempotencyKey,
            cashTenderedCents: input.cashTenderedCents,
          },
        });

    await tx.ledgerEntry.create({
      data: {
        orgId: order.orgId,
        paymentId: payment.id,
        direction: "CREDIT",
        method: input.method,
        amountCents: totalCents,
        memo: `Order ${order.id} confirmed`,
      },
    });

    return { alreadyConfirmed: false, campIds };
  }).then(async (result) => {
    // Side-effect (email) outside the transaction so a slow provider can't hold
    // a DB lock. Re-read the confirmed order for the message.
    if (!result.alreadyConfirmed) {
      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        // Line items (with their service type) drive the PAID block and the
        // will-call list in the confirmation email; the event carries venue,
        // times and the refund policy.
        include: {
          event: true,
          lineItems: { include: { serviceType: true } },
          // Decides whether this email is a ticket or an entry receipt.
          performanceEntry: true,
        },
      });
      await sendConfirmationEmail({
        to: order.registrantEmail,
        registrantName: order.registrantName,
        eventName: order.event.name,
        confirmUrl: `${env.NEXT_PUBLIC_APP_URL}/confirm/${order.id}`,
        campIds: result.campIds,
        // A FEE-kind entry admits nobody, so the wording must not call the
        // code a ticket or promise it admits anyone. The entry URL is keyed on
        // the receipt code, which only exists now that the order is confirmed.
        performanceEntry: order.performanceEntry
          ? {
              groupName: order.performanceEntry.groupName,
              songTitle: order.performanceEntry.songTitle,
              songNeeded: order.performanceEntry.songObjectPath === null,
              entryUrl: `${env.NEXT_PUBLIC_APP_URL}/perform/${result.campIds[0] ?? ""}`,
            }
          : null,
        lineItems: order.lineItems.map((li) => ({
          description: li.serviceType?.name ?? li.description,
          quantity: li.quantity,
          amountCents: li.amountCents,
        })),
        // Only MERCH service types are physical goods handed over at
        // the gate — admission and fee lines have nothing to collect.
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
      });
    }
    return result;
  });
}
