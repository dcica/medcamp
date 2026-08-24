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
 * `afterInteractive` (the default for gtag) keeps the loader off the critical
 * path: it runs after hydration, so a volunteer on a 6" phone on gym WiFi is
 * not waiting on googletagmanager.com to see a queue.
 */
export function Analytics() {
  const measurementId = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!measurementId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  );
}
