/**
 * Where Stripe sends the browser back to, and how long the session stays payable.
 *
 * WHY THIS IS ITS OWN FILE. The cancel URL used to be assembled at two call
 * sites — a default inside createCheckoutForOrder for /register, and a
 * hand-written override in /perform's action. Both had to remember to append
 * `&cancelled=<orderId>`, and the param existed for months with no reader at
 * all, so nothing would have noticed if one of them dropped it. Callers now
 * supply BASE PATHS only; the query contract is built here, once, for every
 * payment flow there will ever be.
 *
 * Deliberately dependency-free — no Prisma, no Stripe, no env — so
 * scripts/verify-checkout.ts can assert the contract without standing up a
 * request or stubbing the Stripe client.
 */

/**
 * How long a Checkout session stays payable, and therefore how long an
 * abandoned order can sit PENDING before `checkout.session.expired` reaps it
 * (src/app/api/stripe/webhook/route.ts).
 *
 * NOT Stripe's 30-minute floor, on purpose. This number is doing two jobs at
 * once and they pull in opposite directions: shorter bounds the orphan, longer
 * keeps the buyer's original Stripe tab alive. Thirty minutes kills the session
 * under anyone who steps away mid-payment on venue wifi — a real walk-in
 * scenario at a camp — and hands them a dead page with no explanation. Sixty
 * still bounds the orphan to the hour and halves that failure.
 *
 * Resuming (resumeCheckoutForOrder) always mints a FRESH session, so this
 * only ever affects a buyer who goes back to the OLD tab.
 */
export const CHECKOUT_TTL_SECONDS = 60 * 60;

/** The identifying facts a return URL is built from. Structural, so a Prisma
 *  Order row and a plain test fixture both satisfy it. */
export type CheckoutReturnOrder = {
  id: string;
  /**
   * Optional even though Order.eventId is currently non-null (schema.prisma:515).
   * Membership and POS orders are not event-scoped, and when that lands this
   * builder must not be the thing that needs editing — the money path is the
   * worst place to be making incidental changes during a schema migration.
   */
  eventId?: string | null;
};

/** Base paths, no query string. The query contract belongs to this module. */
export type CheckoutRoutes = {
  /** Default: /confirm/<orderId> */
  successPath?: string;
  /** Default: /register */
  cancelPath?: string;
};

export type CheckoutReturn = {
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds, for Stripe's `expires_at`. */
  expiresAt: number;
};

/**
 * Build both return URLs and the session expiry.
 *
 * `cancelUrl` ALWAYS carries `cancelled=<orderId>` — that is the whole point of
 * this function. It carries `event=<eventId>` only when the order has one:
 * without it a cancelling buyer landed on a bare form and got whatever the
 * fallback event pool picked, which once dropped a cancelled Diwali buyer onto
 * Navratri's checkout.
 *
 * `now` is injected so the expiry is assertable without freezing the clock.
 */
export function buildCheckoutReturn(
  order: CheckoutReturnOrder,
  appUrl: string,
  routes: CheckoutRoutes = {},
  now: Date = new Date(),
): CheckoutReturn {
  const base = appUrl.replace(/\/+$/, "");

  const successPath = routes.successPath ?? `/confirm/${order.id}`;
  const cancelPath = routes.cancelPath ?? `/register`;

  // Stripe substitutes {CHECKOUT_SESSION_ID} itself, so it must survive
  // unencoded — hence string concatenation rather than URLSearchParams here.
  const successUrl = `${base}${successPath}?session_id={CHECKOUT_SESSION_ID}`;

  const cancelParams = new URLSearchParams();
  if (order.eventId) cancelParams.set("event", order.eventId);
  cancelParams.set("cancelled", order.id);

  return {
    successUrl,
    cancelUrl: `${base}${cancelPath}?${cancelParams.toString()}`,
    expiresAt: Math.floor(now.getTime() / 1000) + CHECKOUT_TTL_SECONDS,
  };
}
