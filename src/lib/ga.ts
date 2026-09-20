import type { EventType } from "@prisma/client";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Server-side Google Analytics 4 via the Measurement Protocol — one event,
 * `purchase`, sent when an order becomes CONFIRMED.
 *
 * WHY SERVER-SIDE. gtag.js only ever saw `page_view`, so GA4 held traffic and
 * no revenue: no conversion rate, and no way to tell which channel actually
 * sold a ticket. Firing `purchase` from the browser on the /confirm page would
 * miss every sale confirmed by the Stripe webhook while the buyer's tab was
 * gone, double-count a page refresh, and be trivially forgeable from the
 * console. Confirmation is the only moment a sale is real, and it happens on
 * the server, so that is where the event is emitted. GA4 dedupes on
 * `transaction_id`, which is the order id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HARD CONSTRAINT: NO MEDICAL SERVICE NAMES LEAVE THIS PROCESS.
 * ─────────────────────────────────────────────────────────────────────────────
 * A camp's `ServiceType.name` values are real clinical service names — "Vision
 * Screening", "Dental Check", "Bloodwork" (prisma/seed.ts). Sending those as
 * `items[].item_name` would attach a per-visitor record of which health
 * services a person bought to a persistent GA `client_id` inside Google's
 * systems. That is:
 *   - a breach of this platform's founding No-PHI/HIT constraint (CLAUDE.md),
 *     which is a promise made to every tenant, not a dcica preference;
 *   - a contradiction of docs/Privacy-Policy.md, which already tells visitors
 *     that no registration or payment data is sent to Analytics; and
 *   - a violation of Google's own prohibition on sending health data to GA4,
 *     which risks the tenant's property being terminated outright.
 *
 * So item detail is gated on `Event.type`, and the gate is an ALLOWLIST that
 * fails closed: only GENERAL and MEMBERSHIP_DRIVE — ticket tiers, merchandise,
 * membership terms, none of it clinical — get a per-line breakdown. CAMP, an
 * absent type, and any enum member added later all collapse to one generic
 * line. Adding a new EventType therefore cannot leak by omission; the worst it
 * can do is under-report, which is the correct direction to fail in.
 * scripts/verify-checkout.ts §10 asserts the camp service names are absent from
 * the serialized payload, and asserts a GENERAL event still carries its names
 * so the redaction is proven conditional rather than blanket-broken.
 */

/** GA4 endpoint. Overridable only so the verify script never needs the network. */
const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * How long Google gets to answer. This runs on the money path (see the
 * post-transaction block in confirmOrderPaid), so an unreachable or slow
 * endpoint must cost a confirmation a couple of seconds at most, never a
 * hung serverless invocation.
 */
const SEND_TIMEOUT_MS = 2000;

/**
 * Event types whose line items are safe to name. An ALLOWLIST, not a
 * blocklist — see the No-PHI note above for why the direction matters.
 */
const DETAIL_ALLOWED: ReadonlySet<string> = new Set<EventType>([
  "GENERAL",
  "MEMBERSHIP_DRIVE",
]);

/** The single line sent in place of a camp's real service breakdown. */
export const REDACTED_ITEM_NAME = "Camp registration";

export type GaLineItem = {
  /** Human description. NEVER reaches Google for a redacted event type. */
  name: string;
  /** Stable service slug, e.g. "bloodwork". Also NEVER reaches Google when redacted. */
  key?: string | null;
  /** Per-unit price in cents. Line total is amountCents × quantity. */
  amountCents: number;
  quantity: number;
};

export type GaPurchaseInput = {
  /**
   * The buyer's GA client id, from Order.gaClientId. Null means "no web
   * session of this buyer's own" and suppresses the event entirely — see
   * buildPurchasePayload.
   */
  clientId: string | null;
  /** Order id. Becomes transaction_id, which is GA4's dedupe key. */
  orderId: string;
  /** Event.type. Anything not in DETAIL_ALLOWED is redacted. */
  eventType: EventType | string | null | undefined;
  /**
   * The event's public slug (src/lib/seo.ts eventSlug) — the SAME string that
   * appears in the /e/<slug> page_view GA already collects, which is what makes
   * a landing page joinable to the sale it produced. Registered as a GA4
   * custom dimension.
   */
  eventSlug: string | null;
  /** PaymentMethod. Registered as a GA4 custom dimension. */
  paymentMethod: string;
  lineItems: GaLineItem[];
};

export type GaItem = {
  item_id: string;
  item_name: string;
  item_category?: string;
  quantity: number;
  price: number;
};

export type GaPurchasePayload = {
  client_id: string;
  events: [
    {
      name: "purchase";
      params: {
        transaction_id: string;
        /** DOLLARS, not cents. GA4 reads `value` as a decimal currency amount. */
        value: number;
        currency: "USD";
        items: GaItem[];
        /** Custom dimensions. */
        event_slug: string | null;
        event_kind: string;
        payment_method: string;
      };
    },
  ];
};

/** Integer cents → a 2-decimal currency number. GA4 rejects cents as a `value`. */
function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Build the exact JSON body that would be POSTed, or null if no event should be
 * sent at all. Pure: no network, no database, no env — which is what lets
 * scripts/verify-checkout.ts assert the redaction over the real serialized
 * bytes rather than over a re-implementation of it.
 *
 * ── WHY A NULL clientId MEANS "SEND NOTHING" ──
 * This will look like a bug to the next reader — a paid order that reports no
 * revenue — so: a walk-in paying cash at the registration desk has no web
 * session. The till volunteer's browser is not the buyer's, and its `_ga`
 * cookie belongs to the volunteer, who has been at that desk all morning.
 * Synthesizing or borrowing a client_id would invent phantom Direct traffic,
 * inflate user counts, and pin a stack of purchases on one "visitor" — which
 * corrupts exactly the channel attribution this whole change exists to produce.
 * GA4's job here is ACQUISITION MEASUREMENT. The reconciliation export is the
 * source of truth for money, and it counts every cash sale. Under-reporting
 * online revenue is a known, accepted gap; fabricating sessions is not.
 */
export function buildPurchasePayload(
  input: GaPurchaseInput,
): GaPurchasePayload | null {
  if (!input.clientId) return null;

  const totalCents = input.lineItems.reduce(
    (s, li) => s + li.amountCents * li.quantity,
    0,
  );
  const units = input.lineItems.reduce((s, li) => s + li.quantity, 0);

  // Fail closed: CAMP, null, undefined, and any EventType added after this was
  // written all land in the redacted branch.
  const detailed = DETAIL_ALLOWED.has(String(input.eventType ?? ""));

  const items: GaItem[] = detailed
    ? input.lineItems.map((li) => ({
        item_id: li.key ?? "line",
        item_name: li.name,
        quantity: li.quantity,
        price: toDollars(li.amountCents),
      }))
    : [
        {
          // One generic line, carrying the TOTAL unit count so GA4's
          // "items purchased" still reflects how many things were bought, and a
          // unit price derived from the order total so quantity × price
          // reconciles with `value`. Rounding can leave a cent of drift on an
          // odd split; GA4 takes revenue from event-level `value`, not from the
          // items array, so the drift is cosmetic.
          item_id: "camp_registration",
          item_name: REDACTED_ITEM_NAME,
          item_category: "Registration",
          quantity: Math.max(units, 1),
          price: toDollars(totalCents / Math.max(units, 1)),
        },
      ];

  return {
    client_id: input.clientId,
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: input.orderId,
          value: toDollars(totalCents),
          currency: "USD",
          items,
          event_slug: input.eventSlug,
          // The KIND is safe to send and is the whole point of the dimension:
          // "camps convert at X, ticketed events at Y". It says nothing about
          // any individual's health.
          event_kind: String(input.eventType ?? "UNKNOWN"),
          payment_method: input.paymentMethod,
        },
      },
    ],
  };
}

/**
 * Is server-side GA reporting configured at all?
 *
 * BOTH halves are required, and the default is off. This is open-source
 * software a stranger self-hosts: nobody may be made to configure Google
 * anything to take a payment, and a deployment that has set neither variable
 * must make zero outbound requests. The measurement id alone is not enough —
 * the Measurement Protocol needs a server-side API secret, and firing without
 * one would be a silently-discarded request on every sale.
 */
export function gaServerEventsEnabled(): boolean {
  return gaConfigured(env.NEXT_PUBLIC_GA_MEASUREMENT_ID, env.GA_API_SECRET);
}

/**
 * The AND, taken as arguments rather than off `env`, so the truth table can be
 * asserted without a process whose environment has been rewritten — the same
 * split, for the same reason, as resolveResumeSecret in lib/checkoutResume.ts.
 */
export function gaConfigured(
  measurementId: string | undefined,
  apiSecret: string | undefined,
): boolean {
  return Boolean(measurementId && apiSecret);
}

export type GaSendResult =
  | "sent"
  | "skipped-unconfigured"
  | "skipped-no-client-id"
  | "failed";

/**
 * Report a confirmed order to GA4. Never throws.
 *
 * Called from the post-transaction block of confirmOrderPaid, deliberately
 * OUTSIDE the transaction and under the same `!alreadyConfirmed` guard that
 * gates the confirmation email — that guard is the atomic claim's "only the
 * winner acts" gate, so the webhook and the confirm page racing to confirm one
 * order produce exactly one purchase event between them.
 *
 * A failure to reach Google MUST NOT fail or roll back a confirmed order. The
 * buyer has paid; an analytics gap is not worth a captured charge attached to a
 * PENDING order (the failure mode the raw-SQL incident produced, and the reason
 * every third-party call on this path is swallowed and logged instead).
 */
export async function sendPurchaseEvent(
  input: GaPurchaseInput,
): Promise<GaSendResult> {
  // EVERYTHING is inside the try, payload construction included. The caller is
  // on the money path and treats this as infallible, so a TypeError from a
  // future edit to buildPurchasePayload must not become a rolled-back sale
  // either — "never throws" has to hold for bugs, not just for network faults.
  try {
    if (!gaServerEventsEnabled()) return "skipped-unconfigured";

    const payload = buildPurchasePayload(input);
    if (!payload) return "skipped-no-client-id";

    const url =
      `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "")}` +
      `&api_secret=${encodeURIComponent(env.GA_API_SECRET ?? "")}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // The Measurement Protocol answers 2xx for a malformed event as readily as
    // a good one, so this only catches transport-level trouble. It is still
    // worth logging: a 4xx here means the api_secret or measurement id is
    // wrong, and the alternative is analytics that silently reports nothing.
    if (!res.ok) {
      log.warn("ga: purchase event rejected", {
        orderId: input.orderId,
        status: res.status,
      });
      return "failed";
    }
    return "sent";
  } catch (err) {
    // Swallowed on purpose — see the doc comment. Never let Google fail a sale.
    log.warn("ga: purchase event send failed", { orderId: input.orderId, err });
    return "failed";
  }
}

/**
 * Pull the GA client id out a `_ga` cookie value.
 *
 * The cookie is `GA1.1.<a>.<b>` (older properties use a different domain-depth
 * digit, e.g. `GA1.2.`), and the client id is the `<a>.<b>` tail — NOT the
 * whole cookie. Sending the whole string attributes the event to nothing.
 *
 * Returns null for anything that is not that shape, so a truncated, empty, or
 * consent-tool-rewritten cookie yields "no client id" rather than a garbage one
 * that would open a phantom session in GA.
 */
export function parseGaCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^GA\d+\.\d+\.(\d+\.\d+)$/.exec(raw.trim());
  return m ? m[1] : null;
}
