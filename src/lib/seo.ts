/**
 * Search-engine surface: canonical URLs, event slugs, venue parsing, and the
 * JSON-LD builders behind every structured-data block on the public site.
 *
 * Everything here is PURE — no database, no network, no React — for the same
 * reason src/lib/branding.ts is: it lets scripts/verify-seo.ts pin the
 * behaviour that matters (slug stability, offset-correct dates, the
 * `</script>` escape) without standing up a database or a browser.
 *
 * ── WHY LOCALITY IS DERIVED FROM EVENTS AND NOT HARDCODED ───────────────────
 *
 * The obvious implementation is a `FLOWER_MOUND` constant. It is also the one
 * the platform mandate forbids: this is a multi-tenant, self-hostable product,
 * and a second org running it from Edison NJ must not have to edit source to
 * stop announcing itself as a Denton County organisation.
 *
 * The alternative — a `settings.seo` block every tenant fills in — has a
 * different problem, and it is the one that would actually have bitten us here:
 * `prisma/seed.ts` upserts the org with `update: {}`, so an org row that
 * already exists (which is every deployed environment) would never receive the
 * new keys. The setting would be correct, empty, and silently do nothing.
 *
 * So locality is READ OFF THE EVENTS. `Event.location` is already a required
 * part of publishing an event, it already carries the town, and it is already
 * maintained — a tenant that moves venues updates it as a matter of course.
 * The most frequent town across an org's listed events IS that org's locality,
 * by definition and without anybody configuring anything. A tenant with no
 * parseable locations gets no local markup at all, which is the honest answer
 * rather than a wrong one.
 *
 * `settings.seo` still overrides, for the org that wants to say something the
 * venue list cannot (a legal name, a phone number, links to its other sites).
 */

import type { Metadata } from "next";
import { z } from "zod";
import { env } from "@/lib/env";
import { CONTACT_EMAIL } from "@/lib/contact";

// ── Canonical origin ────────────────────────────────────────────────────────

/**
 * The origin every canonical, OG and sitemap URL is built from.
 *
 * `NEXT_PUBLIC_APP_URL` and not the request's Host header: the app answers on
 * more than one hostname per environment (the Vercel deployment URL, the
 * per-branch preview URL, and the real domain all reach the same box), and a
 * canonical built from the request would tell Google that
 * `medcamp-test-abc123.vercel.app/` and `test.dcica.org/` are two different
 * pages with identical content. That is a duplicate-content split, and it is
 * self-inflicted. One configured origin, one canonical.
 *
 * Trailing slash stripped so `${siteUrl()}${path}` never yields `//`.
 */
export function siteUrl(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** An absolute URL for a same-origin path (`/e/x` → `https://…/e/x`). */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/**
 * A URL-safe lowercase slug. Unicode is stripped to ASCII where it decomposes
 * (`Diwali Dhamaka` is fine; `Navrātri` becomes `navratri`) because a
 * percent-encoded path segment is unreadable in a search result, which is the
 * one place these slugs are read by a person.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export type SluggableEvent = { name: string; code: string };

/**
 * An event's public path segment: the name, then the event code.
 *
 * WHY the code is appended rather than the id: `Event.code` is already
 * `@@unique([orgId, code])`, so name+code cannot collide inside a tenant, and
 * it is short and human ("dandiya-night-dn-2026") where a cuid is neither. Two
 * Dandiya Nights in successive years are the case that forces this — their
 * names are byte-identical and only the code separates them.
 *
 * WHY not a stored slug column: it would need a migration, and every migration
 * in this repo goes through a gated CI approval. A derived slug costs nothing
 * and cannot drift out of sync with the name it is derived from.
 *
 * The cost, stated plainly: renaming an event changes its URL and the old one
 * 404s. `resolveEventSlug` below softens that by also accepting the bare code,
 * so a link that carries the code at all still lands.
 */
export function eventSlug(e: SluggableEvent): string {
  const name = slugify(e.name);
  const code = slugify(e.code);
  if (!name) return code;
  // A name that already ends in the code ("Dandiya Night DN-2026") must not
  // repeat it — "dandiya-night-dn-2026-dn-2026" is nobody's idea of a URL.
  return name.endsWith(`-${code}`) ? name : `${name}-${code}`;
}

/**
 * Find the event a slug refers to, and say whether the slug was canonical.
 *
 * `exact: false` means the caller should permanently redirect to the canonical
 * slug — which is what keeps a renamed event's old links alive and, more
 * importantly, keeps Google from holding two URLs for one page.
 *
 * Matching is done in memory over the candidate list rather than with a `where`
 * clause because the slug is derived, not stored; there is nothing to query
 * against. Callers pass the org's non-draft events, which is tens of rows.
 */
export function resolveEventSlug<T extends SluggableEvent>(
  candidates: T[],
  slug: string,
): { event: T; exact: boolean } | null {
  const wanted = slug.toLowerCase();
  for (const e of candidates) {
    if (eventSlug(e) === wanted) return { event: e, exact: true };
  }
  // Fallback: the bare event code. Covers a link printed before a rename, and
  // gives flyers a short URL that is safe to typeset.
  for (const e of candidates) {
    if (slugify(e.code) === wanted) return { event: e, exact: false };
  }
  return null;
}

// ── Venue parsing ───────────────────────────────────────────────────────────

export type Venue = {
  /** "McKamy Middle School" — the venue, never the event name. */
  name: string;
  streetAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
};

const STATE = "[A-Z]{2}";
const ZIP = "\\d{5}(?:-\\d{4})?";
/** "Flower Mound, TX" / "Flower Mound, TX 75028" as a trailing segment pair. */
const REGION_ONLY = new RegExp(`^(${STATE})(?:\\s+(${ZIP}))?$`);
/** "Westborough MA" / "Westborough MA 01581" — town and state in one segment. */
const TOWN_REGION = new RegExp(`^(.+?)\\s+(${STATE})(?:\\s+(${ZIP}))?$`);

/**
 * Split a human-typed venue line into schema.org's Place + PostalAddress parts.
 *
 * `Event.location` is one free-text field, and deliberately so — its own schema
 * comment gives "Town Common, Main St, Westborough MA" as the shape, while the
 * seeded events use "McKamy Middle School, Flower Mound, TX". Both are how
 * people actually write an address, and both have to work.
 *
 * Google's Event documentation makes `location.address` REQUIRED, so returning
 * the whole string as an opaque blob is not an option: an address with no
 * addressLocality is an incomplete rich result, which is to say no rich result.
 * Hence a parser rather than a passthrough.
 *
 * It is deliberately conservative. Anything it cannot read confidently comes
 * back with null parts and the full line as `name`, and the caller then emits a
 * Place with a plain-text address — valid schema.org, weaker rich result, and
 * still true. Guessing a town would be worse than admitting we do not know one:
 * a wrong addressLocality is a structured-data policy violation, and for a
 * local-intent site it is a wrong answer to the only question being asked.
 */
export function parseVenue(location: string): Venue {
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const blank: Venue = {
    name: location.trim(),
    streetAddress: null,
    locality: null,
    region: null,
    postalCode: null,
  };
  if (parts.length === 0) return blank;

  const last = parts[parts.length - 1];

  // Form A: "…, Flower Mound, TX" — the state stands alone in the last segment.
  const regionOnly = REGION_ONLY.exec(last);
  if (regionOnly && parts.length >= 2) {
    const locality = parts[parts.length - 2];
    const head = parts.slice(0, parts.length - 2);
    return {
      name: head[0] ?? locality,
      streetAddress: head.slice(1).join(", ") || null,
      locality,
      region: regionOnly[1],
      postalCode: regionOnly[2] ?? null,
    };
  }

  // Form B: "…, Westborough MA" — town and state share the last segment.
  const townRegion = TOWN_REGION.exec(last);
  if (townRegion && parts.length >= 2) {
    const head = parts.slice(0, parts.length - 1);
    return {
      name: head[0],
      streetAddress: head.slice(1).join(", ") || null,
      locality: townRegion[1],
      region: townRegion[2],
      postalCode: townRegion[3] ?? null,
    };
  }

  return blank;
}

/**
 * The town an organisation most often holds events in, with the most recent
 * event breaking a tie.
 *
 * This is the whole locality story: it is what puts "Flower Mound, TX" into the
 * home page title and the Organization block without a line of per-tenant
 * config. Events are expected in the order the public page lists them, soonest
 * first, so the tie-break favours where the org is holding events NOW rather
 * than where it held them three years ago.
 */
export function primaryLocality(
  locations: (string | null)[],
): { locality: string; region: string } | null {
  const counts = new Map<string, { locality: string; region: string; n: number }>();
  for (const raw of locations) {
    if (!raw) continue;
    const v = parseVenue(raw);
    if (!v.locality || !v.region) continue;
    const key = `${v.locality}|${v.region}`;
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { locality: v.locality, region: v.region, n: 1 });
  }
  let best: { locality: string; region: string; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best ? { locality: best.locality, region: best.region } : null;
}

// ── Tenant SEO overrides ────────────────────────────────────────────────────

/**
 * The optional `Organization.settings.seo` block. Every field is optional and
 * an invalid block yields `{}` rather than throwing — `settings` is arbitrary
 * JSON written by the seed, by admin actions and by ad-hoc scripts, and a
 * malformed value must degrade the markup, never take the page down.
 */
const seoSchema = z.object({
  legalName: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(400).optional(),
  telephone: z.string().min(1).max(40).optional(),
  streetAddress: z.string().min(1).max(200).optional(),
  locality: z.string().min(1).max(100).optional(),
  region: z.string().min(2).max(40).optional(),
  postalCode: z.string().min(3).max(12).optional(),
  country: z.string().min(2).max(2).optional(),
  /** Towns the org serves, for `areaServed`. */
  areaServed: z.array(z.string().min(1).max(100)).max(40).optional(),
  /** The org's other web presences — its main site, socials. Absolute URLs. */
  sameAs: z.array(z.string().url()).max(20).optional(),
  /**
   * schema.org NonprofitType, e.g. "Nonprofit501c3".
   *
   * OPT-IN, and it has to be. An earlier draft emitted "Nonprofit501c3"
   * unconditionally because the reference tenant is one — which would have had
   * every self-hoster's site publish a machine-readable claim about its own tax
   * status, on their behalf, without being asked. That is a claim only the org
   * itself can make, so the platform does not make it for them.
   */
  nonprofitStatus: z.string().min(3).max(60).optional(),
});

export type TenantSeo = z.infer<typeof seoSchema>;

export function resolveTenantSeo(settings: unknown): TenantSeo {
  if (!settings || typeof settings !== "object") return {};
  const raw = (settings as Record<string, unknown>).seo;
  const parsed = seoSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

// ── Page-level indexing directives ──────────────────────────────────────────

/**
 * `metadata` for every page that must never appear in a search result.
 *
 * Two populations, one directive. The staff screens (`/admin`, `/dashboard`,
 * `/station`, `/gate`, `/checkin`) are noindex because indexing them is noise.
 * The CAPABILITY URLs are noindex because indexing them is a privacy incident:
 * `/confirm/<orderId>`, `/badge/<campId>`, `/perform/<code>`,
 * `/volunteer/cert/<signupId>` each render a named person's details to whoever
 * holds the link, and the link is mailed out, forwarded and pasted into group
 * chats. This platform's founding constraint is that it stores no PHI; letting
 * an attendee's name and event become a Google result would clear that bar and
 * still be a betrayal of the same promise.
 *
 * `follow: false` as well as `index: false`, because these pages link onward to
 * more of the same — a confirmation links to a badge — and there is no reason
 * to hand a crawler the trail.
 *
 * This is the control. robots.txt deliberately does NOT list these paths, for
 * the reason spelled out in src/app/robots.ts: a disallowed page is a page
 * whose noindex is never read.
 */
export const PRIVATE_PAGE_METADATA = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
} satisfies Metadata;

// ── JSON-LD ─────────────────────────────────────────────────────────────────

/**
 * Serialise a JSON-LD object for a `<script>` body.
 *
 * The `<` escape is the load-bearing line and it is NOT paranoia: every string
 * that reaches here — event name, description, venue — is typed by a
 * coordinator into an admin form, and `JSON.stringify` will happily emit the
 * literal characters `</script>` inside a string. The browser's HTML tokeniser
 * does not care that it is inside a JSON string; it ends the script element
 * there and parses whatever follows as markup. Escaping `<` as `<` is
 * valid JSON, parses back identically, and closes the hole.
 *
 * `&` and `>` go too, which costs nothing and covers the same trick spelled
 * with entities.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

type OrganizationLdInput = {
  orgName: string;
  seo: TenantSeo;
  locality: { locality: string; region: string } | null;
  logoUrl: string | null;
};

/**
 * The org itself, as `NGO` — a schema.org subtype of Organization.
 *
 * NOT `LocalBusiness`, and that is a deliberate refusal rather than an
 * oversight. LocalBusiness expects a real, visitable street address, and this
 * org does not have one: it is volunteer-run and it rents a middle-school gym
 * three times a year. Inventing an address to qualify for a richer result is
 * exactly the "misleading structured data" Google's policy names, and the local
 * pack it would be aimed at is not fed by schema.org anyway — it is fed by a
 * Google Business Profile, which is a claim made by a human being outside this
 * codebase. `NGO` + `areaServed` is the true statement, and true is the only
 * kind of markup worth shipping.
 */
export function organizationLd(input: OrganizationLdInput) {
  const { orgName, seo, locality, logoUrl } = input;
  const address: Record<string, string> = { "@type": "PostalAddress" };
  if (seo.streetAddress) address.streetAddress = seo.streetAddress;
  const town = seo.locality ?? locality?.locality;
  const region = seo.region ?? locality?.region;
  if (town) address.addressLocality = town;
  if (region) address.addressRegion = region;
  if (seo.postalCode) address.postalCode = seo.postalCode;
  address.addressCountry = seo.country ?? "US";

  const areaServed = seo.areaServed ?? (town && region ? [`${town}, ${region}`] : []);

  return prune({
    "@context": "https://schema.org",
    "@type": "NGO",
    "@id": `${siteUrl()}/#organization`,
    name: orgName,
    legalName: seo.legalName,
    url: siteUrl(),
    logo: logoUrl ?? undefined,
    description: seo.description,
    email: CONTACT_EMAIL,
    telephone: seo.telephone,
    // Only emit an address once it says something beyond the country.
    address: Object.keys(address).length > 2 ? address : undefined,
    areaServed: areaServed.length ? areaServed : undefined,
    sameAs: seo.sameAs?.length ? seo.sameAs : undefined,
    // Absent unless the tenant declared it — see the schema field's comment.
    nonprofitStatus: seo.nonprofitStatus,
  });
}

export type EventLdInput = {
  name: string;
  url: string;
  description: string | null;
  /** Already offset-correct — build with `formatVenueIso`, never `toISOString`. */
  startDate: string;
  endDate: string;
  /** Raw `Event.location`; parsed here into Place + PostalAddress. */
  location: string | null;
  imageUrl: string | null;
  status: string;
  organizerName: string;
  offer: {
    priceCents: number;
    currency: string;
    url: string;
    soldOut: boolean;
  } | null;
};

/**
 * schema.org status for an `EventStatus` column value.
 *
 * Every one of them maps to EventScheduled, and the map exists anyway — as the
 * place the next status lands. `EventStatus` has SIX values (DRAFT, OPEN,
 * ACTIVE, CLOSED, PURGEABLE, PURGED) and not one of them means "cancelled":
 * they track an event's LIFECYCLE through the purge pipeline, not whether it is
 * still happening. CLOSED means the camp finished, PURGED means its attendee
 * PII has been erased — both describe an event that took place exactly as
 * announced.
 *
 * So there is deliberately no `EventCancelled` branch here. Adding one requires
 * a column that actually records a cancellation; inferring it from CLOSED would
 * tell every past attendee's search result that the event they went to never
 * happened. When that column lands, this map is the one line that changes.
 */
const EVENT_STATUS: Record<string, string> = {
  DRAFT: "https://schema.org/EventScheduled",
  OPEN: "https://schema.org/EventScheduled",
  ACTIVE: "https://schema.org/EventScheduled",
  CLOSED: "https://schema.org/EventScheduled",
  PURGEABLE: "https://schema.org/EventScheduled",
  PURGED: "https://schema.org/EventScheduled",
};

export function eventLd(e: EventLdInput) {
  const venue = e.location ? parseVenue(e.location) : null;

  // A Place needs an address to be worth anything to Google. When the parser
  // could not find a town, the whole line still goes out as a text address —
  // weaker, but true, and it keeps the required property present.
  const place = venue
    ? prune({
        "@type": "Place",
        name: venue.name,
        address: venue.locality
          ? prune({
              "@type": "PostalAddress",
              streetAddress: venue.streetAddress ?? undefined,
              addressLocality: venue.locality,
              addressRegion: venue.region ?? undefined,
              postalCode: venue.postalCode ?? undefined,
              addressCountry: "US",
            })
          : e.location,
      })
    : undefined;

  return prune({
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.name,
    url: e.url,
    description: e.description ?? undefined,
    startDate: e.startDate,
    endDate: e.endDate,
    eventStatus: EVENT_STATUS[e.status] ?? "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: place,
    image: e.imageUrl ? [e.imageUrl] : undefined,
    organizer: {
      "@type": "Organization",
      name: e.organizerName,
      url: siteUrl(),
    },
    offers: e.offer
      ? prune({
          "@type": "Offer",
          url: e.offer.url,
          // schema.org wants a decimal string, not cents. This is the ONE place
          // that divides, and it does it here rather than at a call site so the
          // rule in src/lib/money.ts ("these are the only conversion points")
          // keeps holding.
          price: (e.offer.priceCents / 100).toFixed(2),
          priceCurrency: e.offer.currency,
          availability: e.offer.soldOut
            ? "https://schema.org/SoldOut"
            : "https://schema.org/InStock",
        })
      : undefined,
  });
}

/** Home → event. Two levels is all the depth this site has. */
export function breadcrumbLd(trail: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

/** Drop undefined/empty keys so the emitted block carries no dead properties. */
function prune<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as T;
}
