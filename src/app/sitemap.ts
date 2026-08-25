import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { absoluteUrl, eventSlug, searchIndexingEnabled } from "@/lib/seo";
import { log } from "@/lib/logger";

/**
 * `/sitemap.xml` — the list of URLs this deployment wants crawled.
 *
 * WHY `force-dynamic`, and it is not boilerplate: a sitemap route with no such
 * declaration is PRERENDERED, which means Next runs this function — and so
 * Prisma — during `next build`. That is precisely the failure that broke every
 * `medcamp-prod` preview deploy for weeks: two pages that did not declare it
 * were the only reason a build needed a database, and the build died on
 * `Environment variable not found: DATABASE_URL`. A DB-reading sitemap is a far
 * more obvious way to reintroduce it. It also has to be dynamic on the merits:
 * a sitemap frozen at build time stops listing events the moment one is added.
 */
export const dynamic = "force-dynamic";

/**
 * Public routes that exist regardless of what is in the database.
 *
 * `/register`, `/perform` and `/volunteer` are listed even though each is a
 * form rather than an article: they are the pages a person lands on from a
 * shared link, they render an event's real name and price server-side, and
 * leaving them out of the sitemap would not stop Google indexing them — it
 * would only stop us saying which URL is canonical.
 *
 * NOT listed, deliberately: `/gate`, `/checkin`, `/station`, `/dashboard`,
 * `/admin`, `/login`, `/staff`, `/403` and every capability URL
 * (`/confirm/<orderId>`, `/badge/<campId>`, `/volunteer/cert/<signupId>`).
 * A sitemap is a request to index, and none of those should ever be indexed —
 * the capability URLs because they render a named person's details to whoever
 * holds the link. Those carry `robots: noindex` on the page itself, which is
 * the control that actually works; see src/app/robots.ts for why robots.txt is
 * the wrong tool for them.
 */
const STATIC_PATHS: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "/", priority: 1.0, changeFrequency: "daily" },
  { path: "/register", priority: 0.8, changeFrequency: "weekly" },
  { path: "/perform", priority: 0.7, changeFrequency: "weekly" },
  { path: "/volunteer", priority: 0.7, changeFrequency: "weekly" },
  { path: "/vendors", priority: 0.5, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // An empty sitemap rather than a 404: the route still answers, so a sitemap
  // submitted against this host by mistake reports "0 URLs" instead of an error
  // somebody then spends an afternoon debugging.
  if (!searchIndexingEnabled()) return [];

  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((s) => ({
    url: absoluteUrl(s.path),
    lastModified: now,
    changeFrequency: s.changeFrequency,
    priority: s.priority,
  }));

  let eventEntries: MetadataRoute.Sitemap = [];
  try {
    const org = await getActiveOrg();
    if (org) {
      // DRAFT is the only status excluded, and the exclusion is the point:
      // a draft is an unannounced event, and submitting one to Google would
      // publish a date the committee has not agreed yet.
      //
      // Past events stay listed on purpose. "dcica diwali 2025" is a real
      // query from a real person checking whether this is the same group they
      // came to last year, and a 404 answers it badly. Google drops a past
      // event from the events carousel by itself, using the endDate in the
      // structured data — which is the right mechanism, because it is the one
      // that knows what today is.
      const events = await db.event.findMany({
        where: { orgId: org.id, status: { not: "DRAFT" } },
        select: { name: true, code: true, updatedAt: true, endsAt: true },
        orderBy: { startsAt: "desc" },
      });

      eventEntries = events.map((e) => ({
        url: absoluteUrl(`/e/${eventSlug(e)}`),
        // `updatedAt`, not `now`: a lastmod that changes on every fetch is a
        // lastmod Google learns to ignore, and then a genuinely edited event
        // gets recrawled no faster than an untouched one.
        lastModified: e.updatedAt,
        // An upcoming event's page changes as prices phase and capacity fills;
        // a finished one never changes again.
        changeFrequency: e.endsAt >= now ? "daily" : "yearly",
        priority: e.endsAt >= now ? 0.9 : 0.4,
      }));
    }
  } catch (err) {
    // A sitemap that 500s is read by Search Console as "the site is broken",
    // and the static half of it is still perfectly true. Degrade, log, serve.
    log.error("sitemap: event listing failed, serving static paths only", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return [...staticEntries, ...eventEntries];
}
