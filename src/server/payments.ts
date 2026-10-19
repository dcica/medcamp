import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { stripe, stripeRequestOptions } from "@/lib/stripe";
import { env } from "@/lib/env";
import { orgBaseUrl } from "@/lib/orgUrl";
import {
  buildCheckoutReturn,
  type CheckoutRoutes,
} from "@/lib/checkoutReturn";
import { signResumeProof, verifyResumeProof } from "@/lib/checkoutResume";
import {
  sendConfirmationEmail,
  sendDonationReceiptEmail,
  sendPaymentFailedEmail,
  sendPaymentProcessingEmail,
} from "@/lib/email";
import { newCampId } from "@/lib/campId";
import { log } from "@/lib/logger";
import { eventSlug } from "@/lib/seo";
import { parseGaCookie, sendPurchaseEvent } from "@/lib/ga";
import { resolveOrgProfile, resolveOrgSite, senderFor } from "@/lib/orgSettings";
import { emailThemeOf } from "@/lib/branding";
import {
  ACH_PROCESSING,
  allowedMethodsFor,
  computeOrderFees,
  readFeePolicy,
  receiptLines,
  type FeeLineKind,
  type FeePolicy,
  type OrderFees,
} from "@/lib/fees";
import { resolveOrgPayments } from "@/lib/orgSettings";
import { contributionOf } from "@/lib/contribution";

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
  /** What Checkout will charge, fee lines included — the only total a screen may show. */
  totalCents: number;
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
    include: { lineItems: true, event: true, org: { include: { domains: true } } },
  });

  // Quantity-aware: a qty-5 merch line costs 5 × the unit price. GOODS only:
  // any fee lines an earlier session left behind are recomputed inside
  // openCheckoutSession, and a $0 order never had any to begin with.
  const goodsCents = orderTotalCents(order.lineItems.filter((li) => !li.feeKind));
  if (goodsCents === 0) {
    throw new Error("Order total is $0 — confirm directly, no checkout needed.");
  }
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }

  const session = await openCheckoutSession(order, routes);
  return { url: session.url, totalCents: session.totalCents, resumeProof: signResumeProof(order.id) };
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
  /** The organisation the request resolved to; a foreign order reads as not-authorised. */
  opts?: { orgId?: string },
): Promise<ResumeOutcome> {
  // Authorisation BEFORE any database read. This ordering is the whole defence
  // against ?cancelled= becoming a PII oracle: an unauthorised caller must not
  // be able to distinguish a real order id from a fabricated one, and the only
  // way to guarantee that is to not look one up.
  if (!verifyResumeProof(orderId, proof)) {
    return { ok: false, reason: "not-authorised" };
  }

  const order = await db.order.findFirst({
    where: { id: orderId, ...(opts?.orgId ? { orgId: opts.orgId } : {}) },
    include: { lineItems: true, event: true, org: { include: { domains: true } } },
  });
  // A valid MAC for an id that no longer exists is still nothing this caller
  // may learn about, so it gets the same answer as a bad MAC.
  if (!order) return { ok: false, reason: "not-authorised" };

  const { successUrl } = buildCheckoutReturn(order, orgBaseUrl(order.org), routes);

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

  // A bank debit in flight: the order is spoken for until Stripe reports the
  // outcome. Opening a second session now would be the double-pay window
  // confirmOrderPaid cannot close.
  const inFlight = await db.payment.count({ where: { orderId: order.id, status: "PROCESSING" } });
  if (inFlight > 0) return { ok: false, reason: "not-resumable" };

  const goodsCents = orderTotalCents(order.lineItems.filter((li) => !li.feeKind));
  if (goodsCents === 0) return { ok: false, reason: "not-resumable" };
  if (!stripe) return { ok: false, reason: "not-resumable" };

  const session = await openCheckoutSession(order, routes);

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
  await expireOtherPendingSessions(order.id, session.id, order.org);

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
  orgId: string,
  orderId: string | undefined,
  proof: string | null | undefined,
): Promise<{ orderId: string; amountCents: number } | null> {
  if (!orderId) return null;
  if (!verifyResumeProof(orderId, proof)) return null;

  const order = await db.order.findFirst({
    where: { id: orderId, orgId },
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
    // A bank debit in flight (PROCESSING) is as live as an open session.
    const live = await tx.payment.count({
      where: { orderId, status: { in: ["PENDING", "PROCESSING"] } },
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

/**
 * A Checkout session completed UNPAID: a bank debit is in flight. Hold the
 * order's capacity now (the same atomic claim confirmation makes, stamped on
 * the order so confirmation does not make it twice), mark the payment
 * PROCESSING with its intent, and tell the buyer. NO ticket: codes are minted
 * only at confirmation, so nothing scans until the money is real. Idempotent:
 * a retried event finds the stamp and holds nothing more.
 */
export async function markPaymentProcessing(
  orderId: string,
  session: { id: string; payment_intent: string | null },
): Promise<{ reserved: boolean }> {
  const reserved = await db.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { lineItems: { include: { serviceType: true } } },
      });
      if (!order || order.status !== "PENDING") return false;
      await tx.payment.updateMany({
        where: { orderId, stripeCheckoutId: session.id, status: { in: ["PENDING", "PROCESSING"] } },
        data: {
          status: "PROCESSING",
          ...(session.payment_intent ? { stripePaymentIntentId: session.payment_intent } : {}),
        },
      });
      if (order.capsReservedAt) return false;
      await claimCapacity(tx, order);
      await tx.order.update({ where: { id: order.id }, data: { capsReservedAt: new Date() } });
      return true;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (reserved) {
    // Outside the transaction, like every email on the money path.
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { event: true, org: true },
    });
    if (order?.event) {
      const profile = resolveOrgProfile(order.org.settings);
      await sendPaymentProcessingEmail(
        {
          to: order.registrantEmail,
          registrantName: order.registrantName,
          eventName: order.event.name,
          orgName: order.org.name,
        },
        { from: senderFor(profile, env.EMAIL_FROM), replyTo: profile.contactEmail },
      );
    }
  }
  return { reserved };
}

/**
 * The bank declined the debit, days after the session completed. Give back
 * exactly what the reservation held (guarded, so `sold` can never go below
 * zero), mark the payment FAILED, leave the order PENDING — payable again by
 * card — and tell the buyer. Idempotent: the stamp is cleared, so a second
 * release gives nothing back twice.
 */
export async function releaseProcessingPayment(
  orderId: string,
  sessionId: string,
): Promise<{ released: boolean }> {
  const released = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { lineItems: true },
    });
    if (!order) return false;
    await tx.payment.updateMany({
      where: { orderId, stripeCheckoutId: sessionId, status: "PROCESSING" },
      data: { status: "FAILED" },
    });
    if (!order.capsReservedAt || order.status !== "PENDING" || !order.eventId) return false;
    const counts = new Map<string, number>();
    for (const li of order.lineItems) {
      if (li.serviceTypeId) {
        counts.set(li.serviceTypeId, (counts.get(li.serviceTypeId) ?? 0) + li.quantity);
      }
    }
    for (const [serviceTypeId, qty] of counts) {
      await tx.serviceCap.updateMany({
        where: { eventId: order.eventId, serviceTypeId, sold: { gte: qty } },
        data: { sold: { decrement: qty } },
      });
    }
    await tx.order.update({ where: { id: order.id }, data: { capsReservedAt: null } });
    return true;
  });

  if (released) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { event: true, org: true },
    });
    if (order?.event) {
      const profile = resolveOrgProfile(order.org.settings);
      await sendPaymentFailedEmail(
        {
          to: order.registrantEmail,
          registrantName: order.registrantName,
          eventName: order.event.name,
          orgName: order.org.name,
        },
        { from: senderFor(profile, env.EMAIL_FROM), replyTo: profile.contactEmail },
      );
    }
  }
  return { released };
}

/**
 * Does this deployment know this order at all?
 *
 * WHY THIS EXISTS. test.dcica.org and events.dcica.org have a webhook endpoint
 * each, and both endpoints live on the SAME Stripe account. Stripe fans every
 * event out to every endpoint on the account, so a purchase made on test is
 * also delivered to prod — whose `prod` schema has never heard of that order.
 * confirmOrderPaid then threw out of findUniqueOrThrow, the route answered 500,
 * and Stripe retried on a schedule forever. Four events were wedged that way
 * and Stripe threatened to disable the endpoint outright.
 *
 * THIS IS NOT MASKING A BUG. The id came from metadata WE set at session
 * creation, and the order row is committed before the session exists, so there
 * is no window where a legitimate order for THIS deployment is missing when its
 * webhook lands. An id we minted that is absent here belongs to the other
 * deployment, and no number of retries will conjure it up.
 */
/**
 * Is this Stripe event MINE to act on? Mine means the order exists in this
 * deployment AND the account the event came from is the order's
 * organisation's: none at all on the platform path (`stripeAccountId` null,
 * platform endpoint), or exactly the connected account on the Connect path.
 * The platform key is shared by every deployment and the Connect endpoint
 * receives every connected account's events, so the endpoint cannot tell —
 * only this can. Anything else is acknowledged with a 200 and ignored.
 */
export async function resolveOwnedOrder(
  orderId: string,
  eventAccount: string | undefined,
  scope: "platform" | "connect",
): Promise<{ id: string } | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, org: { select: { stripeAccountId: true } } },
  });
  if (!order) return null;
  const owned = order.org.stripeAccountId;
  if (scope === "platform") return !owned && !eventAccount ? { id: order.id } : null;
  return owned && eventAccount === owned ? { id: order.id } : null;
}

export async function isKnownOrder(orderId: string): Promise<boolean> {
  const hit = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * The organisation's fee policy as it applies RIGHT NOW, or null for zero: no
 * connected account (the platform-key path — the first tenant's — carries no
 * fee and stays byte-identical to before), no policy stored, or a policy that
 * does not parse. Unreadable is logged at error, because it is an operator
 * mistake that silently costs the platform its fee; it is never the buyer's
 * problem, so it is never thrown.
 */
export function activeFeePolicy(org: {
  name: string;
  settings: unknown;
  stripeAccountId: string | null;
}): FeePolicy | null {
  if (!org.stripeAccountId) return null;
  const stored = readFeePolicy(org.settings);
  if (stored.kind === "ok") return stored.policy;
  if (stored.kind === "unreadable") {
    void log.error("fee policy unreadable; charging no fee", { org: org.name, reason: stored.reason });
  }
  return null;
}

type FeeableLineItem = {
  id: string;
  description: string;
  amountCents: number;
  quantity: number;
  isDonation: boolean;
  membershipPlanId: string | null;
  serviceTypeId: string | null;
  feeKind: FeeLineKind | null;
};

/**
 * Make the order's fee lines match its goods lines and the organisation's
 * policy, and return the fee-inclusive total Checkout will charge.
 *
 * Called from openCheckoutSession and NOWHERE ELSE (verify-checkout §14 pins
 * it): the fee exists only on a Stripe Checkout, so cash, Zelle, check, COMP,
 * $0 and the mint script never carry one. Idempotent: the lines are
 * recomputed from the goods every time, so a resume after a policy change
 * reprices rather than stacking, and a stale fee line on an organisation
 * that has since disconnected is removed rather than charged.
 *
 * The write is one transaction (delete, then create) and is skipped when the
 * stored lines already match — the common case on a resume, and the ONLY
 * case on the platform-key path, where nothing is ever written.
 */
export async function ensureFeeLines(order: {
  id: string;
  orgId: string;
  coverProcessingFee: boolean;
  lineItems: FeeableLineItem[];
  org: { name: string; settings: unknown; stripeAccountId: string | null };
}, processing?: { percentBps: number; fixedCents: number; capCents?: number | null }): Promise<OrderFees> {
  const fees = computeOrderFees(order.lineItems, activeFeePolicy(order.org), {
    coverProcessing: order.coverProcessingFee,
    orgName: order.org.name,
    // The bank rate when the order can only be paid by bank debit.
    processing,
  });

  const existing = order.lineItems.filter((li) => li.feeKind !== null);
  const same =
    existing.length === fees.lines.length &&
    fees.lines.every((want) =>
      existing.some(
        (have) =>
          have.feeKind === want.feeKind &&
          have.amountCents === want.amountCents &&
          have.quantity === want.quantity &&
          have.description === want.description,
      ),
    );
  if (!same) {
    await db.$transaction([
      db.lineItem.deleteMany({ where: { orderId: order.id, feeKind: { not: null } } }),
      ...(fees.lines.length > 0
        ? [
            db.lineItem.createMany({
              data: fees.lines.map((l) => ({
                orgId: order.orgId,
                orderId: order.id,
                feeKind: l.feeKind,
                description: l.description,
                amountCents: l.amountCents,
                quantity: l.quantity,
              })),
            }),
          ]
        : []),
    ]);
  }
  return fees;
}

/**
 * Build and send the ticket email for a CONFIRMED order — the ONE builder,
 * called from confirmOrderPaid's post-transaction block (the webhook path),
 * from the registrations page's resend button, and from the offline script's
 * --resend. Reports delivery (the no-provider console path is not delivery)
 * so a desk can tell whether the guest has their pass. Never throws: email is
 * best-effort and the order is already confirmed.
 *
 * Returns `{ delivered: false }` without sending for an order that is not
 * CONFIRMED or has no event (a general-fund donation gets a receipt, not a
 * ticket — see confirmOrderPaid).
 */
export async function sendTicketEmailFor(orderId: string): Promise<{ delivered: boolean }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    // Line items (with their service type) drive the PAID block and the
    // will-call list; the event carries venue, times and the refund policy.
    // Every link is built from the organisation's own host — this runs from
    // the webhook too, where no request is in scope.
    include: {
      event: true,
      lineItems: { include: { serviceType: true } },
      performanceEntry: true,
      attendees: { select: { campId: true }, orderBy: { seat: "asc" } },
      org: { include: { domains: true } },
    },
  });
  if (!order || !order.event || order.status !== "CONFIRMED") return { delivered: false };

  const base = orgBaseUrl(order.org);
  const profile = resolveOrgProfile(order.org.settings);
  const campIds = order.attendees.map((a) => a.campId).filter((c): c is string => Boolean(c));
  return sendConfirmationEmail(
    {
      to: order.registrantEmail,
      registrantName: order.registrantName,
      eventName: order.event.name,
      confirmUrl: `${base}/confirm/${order.id}`,
      walletBaseUrl: base,
      campIds,
      // A FEE-kind entry admits nobody, so the wording must not call the
      // code a ticket or promise it admits anyone. The entry URL is keyed on
      // the receipt code, which only exists once the order is confirmed.
      performanceEntry: order.performanceEntry
        ? {
            groupName: order.performanceEntry.groupName,
            songTitle: order.performanceEntry.songTitle,
            songNeeded: order.performanceEntry.songObjectPath === null,
            entryUrl: `${base}/perform/${campIds[0] ?? ""}`,
          }
        : null,
      lineItems: order.lineItems.map((li) => ({
        description: li.serviceType?.name ?? li.description,
        quantity: li.quantity,
        amountCents: li.amountCents,
      })),
      // Only MERCH service types are physical goods handed over at the gate —
      // admission and fee lines have nothing to collect.
      merch: order.lineItems
        .filter((li) => li.serviceType?.kind === "MERCH")
        .map((li) => ({
          description: li.serviceType?.name ?? li.description,
          quantity: li.quantity,
        })),
      totalPaidCents: order.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0),
      venue: order.event.location,
      startsAt: order.event.startsAt,
      endsAt: order.event.endsAt,
      allowsRefunds: order.event.allowsRefunds,
      theme: emailThemeOf(order.org.settings),
      // The Pub 1771 statement, from the values snapshotted on the lines at
      // creation; null (nothing said) unless an offering carried one.
      contribution: contributionOf(order.lineItems),
    },
    { from: senderFor(profile, env.EMAIL_FROM), replyTo: profile.contactEmail },
  );
}

/**
 * The buyer's GA client id, read from their first-party `_ga` cookie, or null.
 *
 * ── WHY THE try/catch IS NOT DEFENSIVE CLUTTER ──
 * `cookies()` from next/headers THROWS when there is no request context, and
 * this code is reached from two places that have none: scripts/verify-checkout.ts
 * calls straight into resumeCheckoutForOrder, and any future CLI/cron caller
 * would too. An uncaught throw here would take down checkout in the verify suite
 * and, worse, would mean an analytics nicety could fail a payment. Catching it
 * yields null, which the caller treats as "nothing to record" — the same state
 * as a buyer with no `_ga` cookie at all.
 *
 * next/headers is imported lazily rather than at module scope so that importing
 * this module never depends on the Next runtime being present.
 */
async function readGaClientId(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return parseGaCookie(jar.get("_ga")?.value ?? null);
  } catch {
    return null;
  }
}

/** Mint the Stripe session and record its PENDING Payment row. Shared by create and resume. */
async function openCheckoutSession(
  order: {
    id: string;
    orgId: string;
    /** Null for a general-fund donation; buildCheckoutReturn already handles it. */
    eventId: string | null;
    /** For the bank-debit cutoff; null for a gift. */
    event: { startsAt: Date } | null;
    registrantEmail: string;
    coverProcessingFee: boolean;
    lineItems: FeeableLineItem[];
    /** The organisation: return URLs (orgBaseUrl), the Stripe account the session is created on, the fee and bank-debit policies. */
    org: {
      name: string;
      slug: string;
      settings: unknown;
      domains: { hostname: string; isPrimary: boolean }[];
      stripeAccountId: string | null;
      stripeChargesEnabled: boolean;
      stripeAchEnabled: boolean;
    };
  },
  routes?: CheckoutRoutes,
): Promise<{ id: string; url: string; totalCents: number }> {
  if (!stripe) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }
  // A connected organisation whose onboarding is not finished: Stripe would
  // answer session-create with a 400 nobody can act on. The buyer gets a
  // sentence instead, and no Payment row is minted for a session never opened.
  if (order.org.stripeAccountId && !order.org.stripeChargesEnabled) {
    throw new Error(
      "Online payments are not enabled yet for this organisation. Please try again later, or contact the organisers.",
    );
  }

  const goods = order.lineItems.filter((li) => !li.feeKind);

  // ── Which methods Checkout may offer ──
  // Every line's rule (an offering may be card-only or bank-only), the
  // organisation's bank-debit policy and cutoff, and the connected account's
  // capability, intersected — src/lib/fees.ts allowedMethodsFor. An empty
  // intersection is a sentence to the buyer, BEFORE any Stripe call.
  const serviceIds = goods.map((li) => li.serviceTypeId).filter((id): id is string => Boolean(id));
  const caps =
    order.eventId && serviceIds.length > 0
      ? await db.serviceCap.findMany({
          where: { eventId: order.eventId, serviceTypeId: { in: serviceIds } },
          select: { serviceTypeId: true, onlineMethods: true },
        })
      : [];
  const methodOf = new Map(caps.map((c) => [c.serviceTypeId, c.onlineMethods]));
  const allowed = allowedMethodsFor({
    lines: goods.map((li) => ({
      onlineMethods: (li.serviceTypeId ? methodOf.get(li.serviceTypeId) : undefined) ?? "ANY",
    })),
    totalCents: orderTotalCents(goods),
    eventStartsAt: order.event?.startsAt ?? null,
    now: new Date(),
    policy: resolveOrgPayments(order.org.settings).ach,
    // On the platform key the policy alone decides; a connected account must
    // also have the capability Stripe reported.
    orgAchCapable: order.org.stripeAccountId ? order.org.stripeAchEnabled : true,
  });
  if (allowed.methods.length === 0) {
    throw new Error(allowed.refusal ?? "This order cannot be paid online. Contact the organizer.");
  }
  const bankOnly = allowed.methods.length === 1 && allowed.methods[0] === "us_bank_account";

  // ── The fee lines, HERE and only here ──
  // Every online payment and every resume funnels through this function, so
  // this is the one place the organisation's policy becomes money on an order.
  // `fees.lines` is what was just written (or confirmed already present);
  // `goods` is the order as the buyer built it. A bank-only order's cover is
  // grossed up at the bank rate.
  const fees = await ensureFeeLines(order, bankOnly ? ACH_PROCESSING : undefined);

  const { successUrl, cancelUrl, expiresAt } = buildCheckoutReturn(
    order,
    orgBaseUrl(order.org),
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
    // Which methods, from the shared rule — never a hardcoded list — and
    // instant bank verification: microdeposits add one to two days the
    // cutoff cannot absorb.
    payment_method_types: allowed.methods,
    ...(allowed.methods.includes("us_bank_account")
      ? { payment_method_options: { us_bank_account: { verification_method: "instant" as const } } }
      : {}),
    // Comped ($0) lines are omitted — Stripe's hosted page is the payment
    // receipt, and our own /confirm page shows the full breakdown including
    // comps. Sending them would also risk a zero-amount line-item rejection.
    line_items: [...goods, ...fees.lines]
      .filter((li) => li.amountCents > 0)
      .map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: "usd",
          unit_amount: li.amountCents,
          product_data: { name: li.description },
        },
      })),
    // The platform's fee, moved by Stripe at charge time (direct charge on
    // the connected account). ONLY when there is one: the key is refused on a
    // platform-key session, so sending a zero fee unconditionally would 500
    // the first tenant's every checkout.
    ...(fees.platformFeeCents > 0
      ? { payment_intent_data: { application_fee_amount: fees.platformFeeCents } }
      : {}),
  }, stripeRequestOptions(order.org));

  await db.payment.create({
    data: {
      orgId: order.orgId,
      orderId: order.id,
      method: "STRIPE",
      status: "PENDING",
      amountCents: fees.totalCents,
      stripeCheckoutId: session.id,
      stripeAccountId: order.org.stripeAccountId,
      applicationFeeCents: fees.platformFeeCents > 0 ? fees.platformFeeCents : null,
    },
  });

  // ── Capture the GA client id HERE, and only here ──
  //
  // This is the one function every checkout path funnels through (create and
  // resume both call it), so no server action can forget to do it — which is
  // exactly what happened to `cancelled=` in the return URL: two producers, and
  // the contract had to be centralised in buildCheckoutReturn before it stopped
  // rotting. The GA client id has the same shape of problem.
  //
  // It must be read NOW because now is the only moment it is readable: the
  // cookie belongs to the request that is about to redirect the buyer to
  // Stripe. Confirmation happens later, usually in the Stripe webhook, which is
  // a server-to-server POST carrying no cookies at all.
  //
  // Written only when non-null, never cleared: a resume that happens to run
  // without a request scope (or from a browser that has since dropped the
  // cookie) must not erase an id captured on the first attempt.
  const gaClientId = await readGaClientId();
  if (gaClientId) {
    await db.order.update({
      where: { id: order.id },
      data: { gaClientId },
    });
  }

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url, totalCents: fees.totalCents };
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
  org: { stripeAccountId: string | null },
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
        await stripe.checkout.sessions.expire(payment.stripeCheckoutId, stripeRequestOptions(org));
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
    select: { id: true, status: true, org: { select: { stripeAccountId: true } } },
  });
  if (!order) return false;
  if (order.status === "CONFIRMED") return true;
  if (!sessionId || !stripe) return false;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, stripeRequestOptions(order.org));
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

/**
 * The atomic capacity claim, shared by confirmation and by a bank debit's
 * reservation (markPaymentProcessing) so the two cannot drift. Runs inside
 * the caller's transaction; throws OverCapacityError or MissingCapError, which
 * the caller maps to the webhook's answers.
 */
async function claimCapacity(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    eventId: string | null;
    lineItems: { serviceTypeId: string | null; quantity: number; serviceType: { key: string } | null }[];
  },
): Promise<void> {
  // ── Atomic capacity decrement (DB-enforced, not app-layer) ──
  const counts = new Map<string, number>(); // serviceTypeId -> qty
  for (const li of order.lineItems) {
    if (li.serviceTypeId) {
      // quantity-aware: a qty-3 admission line consumes 3 cap units.
      counts.set(li.serviceTypeId, (counts.get(li.serviceTypeId) ?? 0) + li.quantity);
    }
  }
  for (const [serviceTypeId, qty] of counts) {
    // A service line on an order with no event cannot exist (the donate
    // page writes one donation line and nothing else), so this is a type
    // narrowing with a loud failure, never a branch anyone takes.
    const eventId = order.eventId;
    if (!eventId) throw new Error(`Order ${order.id} has a service line but no event`);
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
      where: { eventId_serviceTypeId: { eventId, serviceTypeId } },
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
        eventId,
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
}

type ConfirmInput = {
  method: "STRIPE" | "CASH" | "ZELLE" | "CHECK";
  stripePaymentIntentId?: string;
  stripeCheckoutId?: string;
  /** Guards against double-processing on webhook retries (decision #2). */
  idempotencyKey: string;
  cashTenderedCents?: number;
  /**
   * This is a RECONSTRUCTION of a sale that already happened, not a live one.
   * Exactly one caller sets it: scripts/mint-offline-order.ts --historical,
   * recording money taken at a finished event on a rail the app could not see
   * (a card terminal, cash never rung up).
   *
   * Suppresses both post-sale side effects, and both for the same reason —
   * they describe something happening NOW:
   *   - the confirmation email: those people attended, so mailing them a QR
   *     pass for a night that is over is worse than sending nothing;
   *   - the GA4 `purchase`: it would book last night's revenue against today's
   *     date and pollute acquisition attribution.
   *
   * Everything that makes the record true still runs, because it is inside the
   * transaction and is the whole point: atomic cap decrement, campId
   * assignment, line items PAID, Payment{SUCCEEDED}, LedgerEntry{CREDIT}.
   *
   * NEVER set this on a live sale. The email IS the ticket on every other path,
   * and the mint script's three delivery safeguards exist precisely because
   * dispatch() swallows provider errors. The script gates it on the event
   * having ended.
   */
  historical?: boolean;
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
    // Shared with a bank debit's reservation (claimCapacity). Skipped here when
    // the reservation already made the claim: the stamp is what says so, and
    // making it twice would sell the same seat to the same buyer twice.
    if (!order.capsReservedAt) await claimCapacity(tx, order);

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
    // Null for a general-fund donation, which mints no code: it has no
    // attendees, so the loop below never asks for the prefix.
    const ev = order.eventId
      ? await tx.event.findUniqueOrThrow({
          where: { id: order.eventId },
          select: { code: true },
        })
      : null;

    const campIds: string[] = [];
    const claimed = new Set<string>();
    for (const att of order.attendees) {
      // An attendee on an order with no event cannot exist (see `ev` above);
      // the throw is a type narrowing with a loud failure.
      if (!ev) throw new Error(`Order ${order.id} has an attendee but no event`);
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
      // A general-fund donation has no event and no attendees, so this loop
      // body never runs for one; the optional chain is for the type.
      for (const station of order.event?.stations ?? []) {
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

    // The platform's fee, booked OUT of the organisation's receipts: Stripe
    // moved it at charge time, so the CREDIT above overstates what the
    // organisation keeps by exactly this. Only ever present on a Checkout
    // opened on a connected account — see ensureFeeLines.
    if ((payment.applicationFeeCents ?? 0) > 0) {
      await tx.ledgerEntry.create({
        data: {
          orgId: order.orgId,
          paymentId: payment.id,
          direction: "DEBIT",
          method: input.method,
          amountCents: payment.applicationFeeCents ?? 0,
          memo: "Platform service fee",
        },
      });
    }

    return { alreadyConfirmed: false, campIds };
  }, {
    /**
     * EXPLICIT, because the default is 5s and this transaction is O(party size).
     *
     * campId assignment cannot be batched — every attendee gets a different
     * random token — so a party of N costs N uniqueness SELECTs plus N
     * UPDATEs, sequentially, plus a station visit per attendee on a camp.
     * A ten-ticket order is over twenty round trips inside one budget.
     *
     * Measured 2026-09-28 minting a Package of 10 against the deployed test
     * database: `5105 ms passed since the start of the transaction`, and the
     * whole confirmation rolled back. The app itself normally shares a region
     * with the database and has far more headroom, but the failure mode when
     * it does not is the expensive one — Stripe has taken the money, the
     * webhook 500s, and the order sits PENDING with no ticket. Stripe's retry
     * heals it, eventually, while the buyer stares at a pending page.
     *
     * A longer budget is not a licence to do more work in here. The atomic
     * cap decrement and the campId assignment have to stay in one transaction
     * (that is the whole point of decision #2); anything that does not, goes
     * in the .then() below, as the email already does.
     */
    timeout: 20_000,
    maxWait: 10_000,
  }).then(async (result) => {
    // Side-effect (email) outside the transaction so a slow provider can't hold
    // a DB lock. Re-read the confirmed order for the message.
    if (!result.alreadyConfirmed && !input.historical) {
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
          // Every link in the email is built from the organisation's own host.
          // This block runs from the webhook, where no request is in scope.
          org: { include: { domains: true } },
        },
      });
      const profile = resolveOrgProfile(order.org.settings);
      const sender = { from: senderFor(profile, env.EMAIL_FROM), replyTo: profile.contactEmail };
      if (!order.event) {
        // ── A general-fund donation: a receipt, not a ticket ──
        // The amount is the organisation's receipts (the platform's fee
        // excluded; the cover included — it is the organisation's). The
        // stamp records DELIVERY: the no-provider console path is not a
        // receipt in anyone's inbox, so it leaves receiptSentAt null.
        const { delivered } = await sendDonationReceiptEmail(
          {
            to: order.registrantEmail,
            donorName: order.registrantName,
            orgName: order.org.name,
            legalName: profile.legalName,
            ein: profile.ein,
            receiptStatement: profile.receiptStatement,
            paidAt: new Date(),
            amountCents: receiptLines(order.lineItems).reduce(
              (s, li) => s + li.amountCents * li.quantity,
              0,
            ),
            honoreeName: order.honoreeName,
            theme: emailThemeOf(order.org.settings),
          },
          sender,
        );
        if (delivered) {
          await db.order.update({ where: { id: order.id }, data: { receiptSentAt: new Date() } });
        }
      } else {
        // The ONE ticket-email builder, shared with the resend button and the
        // offline script, so the three can never drift.
        await sendTicketEmailFor(order.id);
      }

      // ── GA4 `purchase`, same guard, same side of the transaction ──
      //
      // Under `!alreadyConfirmed` because that is the atomic claim's "only the
      // winner acts" gate: the Stripe webhook and the confirm page's
      // synchronous verify both race to confirm one order, and exactly one of
      // them gets past the claim. Hooking the webhook route instead would miss
      // every sale the confirm page won, and hooking both would double-count —
      // GA4 dedupes on transaction_id, but not reliably across sessions.
      //
      // Outside the transaction for the same reason the email is: a slow third
      // party must not hold a DB lock on the money path. sendPurchaseEvent
      // never throws, so a Google outage cannot fail or roll back a sale that
      // has already been paid for.
      //
      // The line items are passed in FULL, service names included, and
      // src/lib/ga.ts decides what may leave the process. That is deliberate:
      // the No-PHI redaction is one allowlist in one place rather than a rule
      // every future caller has to remember, and scripts/verify-checkout.ts §10
      // asserts over the serialized payload that a camp's clinical service
      // names do not survive it.
      await sendPurchaseEvent({
        // Null for a cash walk-in — the till volunteer's browser is not the
        // buyer's — which suppresses the event rather than inventing a session.
        // See buildPurchasePayload for why that is the right trade.
        clientId: order.gaClientId,
        site: resolveOrgSite(order.org.settings),
        orderId: order.id,
        // A general-fund donation reports as its own kind, with no landing page.
        eventType: order.event?.type ?? "DONATION",
        // The same slug the /e/<slug> page_view carries, so a landing page can
        // be joined to the sale it produced.
        eventSlug: order.event ? eventSlug(order.event) : null,
        paymentMethod: input.method,
        // The ORGANISATION's receipts: the platform's fee is not its revenue
        // and must not inflate its purchase value in analytics. The cover
        // stays — that is the organisation's money.
        lineItems: receiptLines(order.lineItems).map((li) => ({
          name: li.serviceType?.name ?? li.description,
          key: li.serviceType?.key ?? null,
          amountCents: li.amountCents,
          quantity: li.quantity,
        })),
      });
    }
    return result;
  });
}
