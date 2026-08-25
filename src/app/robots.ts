import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl, searchIndexingEnabled } from "@/lib/seo";

/**
 * `/robots.txt`.
 *
 * `force-dynamic` for the same reason every other route declares it, plus one
 * specific to this file: the sitemap URL below is built from
 * `NEXT_PUBLIC_APP_URL`, and a prerendered robots.txt would bake in whatever
 * that variable happened to be at BUILD time. Vercel builds and Vercel runtime
 * do not always agree on it, and a robots.txt advertising a sitemap on the
 * wrong host is worse than none: Search Console reports it as unreachable and
 * stops asking.
 */
export const dynamic = "force-dynamic";

/**
 * Paths no crawler should spend a request on.
 *
 * These are machinery and staff screens. Every one of them either redirects to
 * `/login` or 403s for an anonymous visitor, so nothing here is a secret being
 * kept by robots.txt — which could not keep one anyway, since the file is
 * public and is read by exactly the people you would least like reading a list
 * of your admin paths.
 */
const DISALLOW = [
  "/api/",
  "/admin/",
  "/dashboard",
  "/station/",
  "/checkin",
  "/volunteers/", // plural: the coordinator dashboard. /volunteer is public.
  "/volunteer/checkin",
  "/gate",
  "/login",
  "/staff",
  "/403",
  // Dev-only routes. They are gated in code, and they must never be a search
  // result regardless.
  "/test-login",
];

/**
 * ── WHY THE CAPABILITY URLS ARE NOT IN THAT LIST ────────────────────────────
 *
 * `/confirm/<orderId>`, `/badge/<campId>`, `/perform/after-payment/<orderId>`,
 * `/volunteer/confirm/<signupId>` and `/volunteer/cert/<signupId>` render a
 * named person's details to whoever holds the link. They are the pages it
 * matters most to keep out of an index. They are deliberately absent here.
 *
 * That is not an oversight, it is how the two mechanisms actually work.
 * `Disallow` forbids CRAWLING, and a page Google may not crawl is a page whose
 * `noindex` Google never reads. Google is explicit that a disallowed URL can
 * still be indexed — URL and anchor text only, no content — if it finds a link
 * to it from anywhere. And these URLs leak by their nature: they are mailed to
 * attendees, forwarded, pasted into WhatsApp, and synced by browsers.
 *
 * So the two rules compose backwards. Disallowing them would GUARANTEE the
 * `noindex` is never seen, and a leaked confirmation URL could then be indexed
 * as a bare link under the attendee's name. Leaving them crawlable means the
 * first crawl reads `noindex` and the URL is dropped permanently.
 *
 * The `noindex` is therefore the control, and it lives on each page's own
 * `metadata` export. Do not "tighten" this by adding them here.
 */

export default function robots(): MetadataRoute.Robots {
  // A deployment that must not be indexed at all refuses everything and
  // advertises no sitemap. Belt and braces with the sitewide `noindex` the root
  // layout emits under the same flag: robots.txt stops the crawl, the meta tag
  // handles anything already crawled. Neither alone is sufficient — see the
  // capability-URL note above for why Disallow is not an indexing control.
  if (!searchIndexingEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        // One group for every crawler, AI assistants included — GPTBot,
        // ClaudeBot and PerplexityBot get the same access as Googlebot, and
        // that is a decision rather than a default. This is a volunteer-run
        // non-profit whose problem is that people in the next town do not know
        // its events exist; "when is the Denton County garba" being answerable
        // by an assistant is the outcome, not a leak. There is nothing here to
        // ration: the public pages are posters and prices, and everything worth
        // protecting is already behind the Disallow list above.
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    // `host` is a Yandex directive. GOOGLE IGNORES IT — do not rely on it to
    // stop the Vercel deployment URLs (`medcamp-test-<hash>.vercel.app`) being
    // indexed as a second copy of the site. The thing that actually prevents
    // that is the per-page `alternates.canonical`, which resolves against
    // NEXT_PUBLIC_APP_URL rather than the request's Host header — see the
    // comment on `siteUrl`. This line is kept because it is true and free, not
    // because it is load-bearing.
    host: siteUrl(),
  };
}
