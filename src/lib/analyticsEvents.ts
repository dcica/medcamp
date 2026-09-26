/**
 * GA4 funnel events, fired from the client.
 *
 * Until this existed the property received `page_view` and nothing else, which
 * cannot answer the only question worth asking about a checkout: are people
 * failing to REACH it, or failing to COMPLETE it. Those two have opposite
 * fixes — one is a discovery problem, the other a form problem — and a
 * pageview-only property cannot tell them apart.
 *
 * ── WHY THERE IS NO `items[]` HERE, AND WHY YOU MUST NOT ADD ONE ────────────
 *
 * GA4's e-commerce recipe wants an `items` array carrying per-item names. On
 * this platform an item name is a camp service — `Vision Screening`,
 * `Bloodwork`, `Blood Pressure Check` — and the platform's founding constraint
 * is that no PHI leaves it: the camp module stores name, phone and paid services
 * only, and "which clinical screening this person bought" is exactly the kind of
 * fact the No-PHI rule exists to keep out of a third party's hands. Sent to
 * Google it would be keyed to a client id that also visits the confirmation
 * page, which amounts to handing out a per-person list of screenings.
 *
 * Item-level detail is therefore handled exclusively server-side, where names
 * can be mapped to non-clinical labels before anything is transmitted. The
 * defence chosen here is structural rather than a warning comment on each call
 * site: this module has no parameter that can carry an item name, so NO client
 * call site can leak one — including a future one written by someone who never
 * read this header. `value` + `currency` + the two custom dimensions are enough
 * to power the funnel; conversion rate and drop-off are counts and sums, not
 * names.
 *
 * So if you are here because the GA4 debug view complains about a missing
 * `items` array on `view_item` / `begin_checkout`: that omission is the point.
 * Do not "fix" it. Server-side is where item detail belongs.
 *
 * ── SAFETY POSTURE ─────────────────────────────────────────────────────────
 *
 * `window.gtag` is undefined far more often than it is defined:
 *
 *  - `Analytics.tsx` renders NOTHING unless the tenant set a measurement id, so
 *    on a self-hosted deployment that never opted in — and in local dev and CI —
 *    it is undefined permanently.
 *  - It loads `afterInteractive`, so even on a configured tenant there is a
 *    window after hydration where it is not there yet.
 *  - Any ad blocker removes it, on a meaningful share of real traffic.
 *
 * Every function below is a silent no-op in all of those cases. Instrumentation
 * must never be able to break a registration: a throw inside a submit handler
 * would abort the hop to Stripe, and a console warning would print on every
 * page of every deployment that has analytics off — which is most of them.
 *
 * Nothing here touches `window` at module scope, so this file is safe to import
 * anywhere in a Server Component's tree; the `typeof window` check happens per
 * call.
 */

/** The only gtag shape this module uses. */
type GtagFn = (
  command: "event",
  eventName: string,
  params?: Record<string, unknown>,
) => void;

/**
 * Read `window.gtag` through a cast rather than a `declare global`.
 *
 * A `declare global { interface Window { gtag?: … } }` here would merge with any
 * other module that augments `Window` the same way, and a merge only compiles
 * when both declarations give the property an IDENTICAL type. Two files each
 * declaring a perfectly reasonable gtag signature is then a build break in a
 * file neither author touched. A local cast has the same runtime behaviour and
 * cannot collide.
 */
function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { gtag?: unknown }).gtag;
  return typeof fn === "function" ? (fn as GtagFn) : null;
}

/**
 * Cents → GA4 `value`.
 *
 * GA4 wants a decimal currency amount; this codebase stores integer cents
 * everywhere. `lib/money.ts` calls itself the only conversion point and this is
 * its analytics-side twin — deliberately NOT reusing `formatCents`, which
 * returns a string ("$25.00") and would land in the report as text rather than
 * as a summable number.
 *
 * A missing or non-finite amount becomes 0 rather than being dropped: a free
 * event genuinely is worth zero, and an event with no `value` at all is
 * excluded from GA4's revenue-weighted views, where it reads as lost traffic
 * instead of as a free ticket.
 */
function toValue(cents: number | null | undefined): number {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * The two custom dimensions, registered in GA4 as `event_slug` and
 * `event_kind`. Omitted rather than sent empty when a call site genuinely does
 * not know one: an empty string is a real value to GA4 and would show up in
 * reports as its own row beside the named events.
 */
function dims(
  eventSlug: string | null | undefined,
  eventKind?: string | null,
): Record<string, unknown> {
  return {
    ...(eventSlug ? { event_slug: eventSlug } : {}),
    ...(eventKind ? { event_kind: eventKind } : {}),
  };
}

/** The one place a gtag call can fail without taking its caller down with it. */
function send(name: string, params: Record<string, unknown>): void {
  const g = gtag();
  if (!g) return;
  try {
    g("event", name, params);
  } catch {
    // Deliberately silent — see SAFETY POSTURE above. These calls sit inside
    // submit handlers, where a throw costs a registration.
  }
}

/**
 * `eventSlug` / `eventKind` are optional because two call sites cannot supply
 * them today: `/register` receives only an event id from its server page, and
 * the entry form on `/perform` is handed the event's name but not its code,
 * which `eventSlug()` needs to derive a slug. Typing them as required would
 * force those pages to invent a value, and a made-up slug in a report is worse
 * than an absent one.
 */
type EventFunnelArgs = {
  eventSlug?: string | null;
  eventKind?: string | null;
  valueCents?: number | null;
};

/** GA4 `view_item` — somebody looked at an event's own page. Funnel step 1. */
export function trackViewItem({
  eventSlug,
  eventKind,
  valueCents,
}: EventFunnelArgs): void {
  send("view_item", {
    value: toValue(valueCents),
    currency: "USD",
    ...dims(eventSlug, eventKind),
  });
}

/**
 * GA4 `begin_checkout` — the buyer submitted and is about to leave for Stripe.
 *
 * Funnel step 2, and the step that makes the drop-off readable: the gap between
 * `view_item` and this one is abandonment in the form, the gap between this one
 * and `purchase` is abandonment at Stripe. Those have different fixes, which is
 * the whole reason this event exists.
 */
export function trackBeginCheckout({
  eventSlug,
  eventKind,
  valueCents,
}: EventFunnelArgs): void {
  send("begin_checkout", {
    value: toValue(valueCents),
    currency: "USD",
    ...dims(eventSlug, eventKind),
  });
}

/**
 * GA4 `sign_up`. `method` records WHICH door: a volunteer signup is not an
 * account registration, and the two have to stay separable in the report if
 * another signup surface is ever instrumented.
 */
export function trackSignUp({ method }: { method: string }): void {
  send("sign_up", { method });
}

/**
 * GA4 `generate_lead` — a competition entry.
 *
 * Not `begin_checkout` and not `purchase`, even though money changes hands: an
 * entry admits NOBODY to the event, which is exactly why its service kind is
 * `FEE` and not `ADMISSION`. Counting it as a ticket sale would inflate the
 * admission funnel with people who still have to buy a ticket to get in the
 * door. `generate_lead` keeps the two conversions countable side by side.
 */
export function trackGenerateLead({
  eventSlug,
  valueCents,
}: {
  eventSlug?: string | null;
  valueCents?: number | null;
}): void {
  send("generate_lead", {
    value: toValue(valueCents),
    currency: "USD",
    ...dims(eventSlug),
  });
}
