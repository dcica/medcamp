import Script from "next/script";

import { env } from "@/lib/env";

/**
 * Google Analytics 4 (gtag.js).
 *
 * Renders NOTHING unless the tenant has set NEXT_PUBLIC_GA_MEASUREMENT_ID to a
 * well-formed `G-…` id. That default-off posture is deliberate:
 *
 *  - This is an open-source, multi-tenant platform. A hardcoded measurement id
 *    would ship one tenant's analytics property to every self-hoster.
 *  - Local dev and CI stay clean — no pageviews from `npm run dev`.
 *  - The Privacy Policy's Third-Party Services table lists Google Analytics as
 *    conditional; leaving the var unset is what makes that true for a tenant
 *    that hasn't opted in.
 *
 * The id is shape-validated in lib/env.ts before it reaches the inline snippet
 * below. See the comment there — that check is load-bearing, not cosmetic.
 *
 * `afterInteractive` keeps the loader off the critical path: it runs after
 * hydration, so a volunteer on a 6" phone on gym WiFi is not waiting on
 * googletagmanager.com to see a queue.
 *
 * ── WHY THE ROUTE GUARD IS IN THE SNIPPET AND NOT A `usePathname()` HOOK ──────
 *
 * The obvious way to keep the tag off the staff screens is to make this a
 * client component and read `usePathname()`. That is wrong here, and the reason
 * is worth writing down because it fails SILENTLY — the tag simply disappears
 * everywhere, on every route, and nothing errors.
 *
 * `next/script` with `afterInteractive` renders `null` on the server in the App
 * Router (next/dist/client/script.js: the appDir branch returns null and the
 * real <script> element is created in a useEffect). The id therefore has to
 * reach the BROWSER. Today it does, as an RSC-serialized prop, precisely
 * because this is a SERVER component: the inline body is computed on the server
 * and shipped as a prop to next/script's own client component.
 *
 * Add "use client" to this file and `@/lib/env` gets bundled for the browser,
 * where Next substitutes an env shim holding NOTHING: the build inlines only
 * literal `NEXT_PUBLIC_*` member expressions, and lib/env.ts hands the whole
 * environment object to zod instead, so not one value is inlined.
 * `env.NEXT_PUBLIC_GA_MEASUREMENT_ID` becomes `undefined` in the browser, this
 * component returns null there, and analytics is dead on a configured tenant
 * with no error anywhere. Reading the raw environment directly to dodge that is
 * also out: an inline <script> is the one place an unvalidated env read is
 * arbitrary JS execution, and scripts/verify-branding.ts §15 forbids a raw
 * environment read in this file by name.
 *
 * So the pathname is read where the script actually runs: in the browser, off
 * `window.location`, by the guard at the top of the snippet. Same mechanism as
 * the URL scrubbing below, and the same property — request data is a VALUE
 * handed to JS, never text concatenated into a script body. It also gives a
 * stronger result than the hook would: the guard returns before the loader
 * element is created, so a suppressed route makes NO request to
 * googletagmanager.com at all, rather than loading gtag.js and merely
 * withholding the config call.
 *
 * The cost is that the loader is injected by the snippet instead of by its own
 * next/script element — which is what Google's own published snippet does — and
 * that ~700 bytes of inert, self-cancelling JS is still emitted on a staff
 * route. That is the whole residue. scripts/verify-analytics.ts executes this
 * snippet in a vm with a fake `window.location` and asserts both halves.
 */

/**
 * Route prefixes where the tag does not initialise.
 *
 * These are the staff / day-of operational screens. A 400-patient camp puts
 * ~40 volunteer phones on venue WiFi scanning, refreshing queues and reloading
 * a dashboard for six straight hours — more page views in one morning than the
 * public site sees in a month, all of them from a handful of devices on one IP.
 * Left tracked, they wreck every metric with sessions in the denominator
 * (conversion rate, bounce, avg. engagement) in exactly the week the tenant
 * most wants to read them, and they do it invisibly: the numbers look
 * plausible, just wrong.
 *
 * Matching is prefix-on-a-segment-boundary, never a bare `startsWith`:
 * `/volunteer/checkin` is a staff screen while `/volunteer` (the signup form)
 * and `/volunteers` (the public roster) are both public funnel. A bare prefix
 * test on "/volunteer" would silently stop tracking the two pages the
 * volunteer-recruitment funnel is measured on.
 *
 * This const is the reviewable copy of the list; the snippet below carries a
 * literal copy because it may not interpolate anything but the measurement id
 * (see the note on the snippet). scripts/verify-analytics.ts §1 parses the
 * snippet's array and asserts the two are identical, so the copies cannot
 * drift — that check is what makes duplicating the list acceptable.
 */
export const STAFF_PATH_PREFIXES = [
  "/admin",
  "/staff",
  "/dashboard",
  "/station",
  // The merged scan station. /gate and /checkin are now redirects TO it, and
  // both stay listed: a redirect still renders a pageview at the old path.
  "/scan",
  // The guest ticket wallet. NOT staff, but excluded for a stronger reason:
  // the campId is a PATH segment, and the page_location scrubber is a
  // query-param denylist -- it would ship a live ticket credential to GA on
  // every view. There is nothing to measure here anyway.
  // No trailing slash: the snippet strips one from the path before matching,
  // so "/t/" could never equal it. Still precise -- the matcher is
  // `path === prefix || path.startsWith(prefix + "/")`, so a future /teams
  // route would not be caught by this.
  "/t",
  "/gate",
  "/checkin",
  "/badge",
  "/volunteer/checkin",
  "/test-login",
] as const;

/**
 * Query params stripped from `page_location` before it is reported.
 *
 * A DENYLIST, deliberately — never a wholesale strip of the query string.
 * gtag reads `utm_source` / `utm_medium` / `utm_campaign` / `gclid` etc. out of
 * the page URL to attribute a session to a campaign, so dropping the whole
 * query would delete the attribution data that motivated this change in the
 * first place, and it would do it silently: acquisition reports keep rendering,
 * every session just becomes "direct".
 *
 * What is on the list and why:
 *  - `session_id` — `/confirm/[orderId]?session_id=cs_live_…` is where Stripe
 *    returns a paying customer. That is a LIVE Checkout Session id, and every
 *    purchase would write one into GA's `page_location`, where it persists in
 *    reports and in any BigQuery export indefinitely.
 *  - `cancelled` — carries an internal order id on the abandon path.
 *  - `code` — per-person confirmation code (the lab-status / badge lookup key).
 *  - `token` — any single-use link token, present or future.
 *
 * Same duplication contract as STAFF_PATH_PREFIXES above: the snippet holds the
 * literal copy, verify-analytics.ts §5 pins them equal.
 */
export const STRIPPED_QUERY_PARAMS = [
  "session_id",
  "cancelled",
  "code",
  "token",
] as const;

export function Analytics() {
  const measurementId = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!measurementId) return null;

  return (
    <>
      {/*
        Everything in the snippet is STATIC JavaScript apart from the
        interpolated measurement id, and that is a hard rule, not a
        coincidence: this is an inline <script>, so anything interpolated here
        is executed. The id is the only value allowed through and it is
        shape-validated by GA_MEASUREMENT_ID_RE in lib/env.ts;
        scripts/verify-branding.ts §15 pins that no other interpolation appears.

        That rule is why the route list and the param denylist are duplicated as
        literals here instead of interpolated from the consts above, and why the
        pathname and URL are read off `window.location` at run time rather than
        rendered in. A pathname carrying a closing script tag or a quote would be
        script injection on every page — the same hole the branding colours are
        guarded against in lib/branding.ts.

        `window.gtag` is assigned explicitly rather than declared as a bare
        `function gtag(){}`, because the IIFE the guard needs would otherwise
        make it a local. lib/analyticsEvents.ts calls `window.gtag` for the
        funnel events and no-ops when it is absent, which is exactly the
        behaviour wanted on a suppressed route.

        Order is load-bearing. gtag DISCARDS a `consent default` that arrives
        after `config`, so both consent calls precede it, and the loader is
        appended last so the queue is already populated when gtag.js reads it.

        Known residual: `page_location` is set for the initial page_view. GA4's
        enhanced measurement also fires a page_view on client-side history
        changes; those carry the raw URL, and one can fire on a staff route
        entered by client navigation from a public one, because gtag.js is
        already loaded by then and no unmount can recall it. Closing that needs
        `send_page_view: false` plus a manual page_view per route — deliberately
        not done here.
      */}
      <Script id="ga-init" strategy="afterInteractive">
        {`(function(){
  var staff = ['/admin','/staff','/dashboard','/station','/scan','/t','/gate','/checkin','/badge','/volunteer/checkin','/test-login'];
  var path = window.location.pathname;
  if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
  for (var i = 0; i < staff.length; i++) {
    if (path === staff[i] || path.indexOf(staff[i] + '/') === 0) return;
  }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  gtag('consent', 'default', {'region': ['EEA','GB','CH'], 'ad_storage': 'denied', 'ad_user_data': 'denied', 'ad_personalization': 'denied', 'analytics_storage': 'denied'});
  gtag('consent', 'default', {'ad_storage': 'denied', 'ad_user_data': 'denied', 'ad_personalization': 'denied', 'analytics_storage': 'granted'});
  gtag('js', new Date());
  gtag('config', '${measurementId}', {'page_location': (function(){
    var strip = ['session_id','cancelled','code','token'];
    try {
      var u = new URL(window.location.href);
      for (var j = 0; j < strip.length; j++) { u.searchParams.delete(strip[j]); }
      return u.toString();
    } catch (e) {
      return window.location.origin + window.location.pathname;
    }
  })()});
  var loader = document.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=${measurementId}';
  document.head.appendChild(loader);
})();`}
      </Script>
    </>
  );
}
