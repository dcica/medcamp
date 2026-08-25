/**
 * Verifies the search surface: canonical URLs, event slugs, venue parsing, the
 * offset-correct dates in the structured data, and the indexing directives that
 * keep an attendee's confirmation page out of Google.
 *
 * WHY THIS SUITE EXISTS: before this change the entire app exported ONE
 * `metadata` object — the root layout's, hardcoded to "DCICA" — and there was
 * no sitemap, no robots.txt, and no `noindex` anywhere. That last one is the
 * reason this suite is not merely nice to have. `/confirm/<orderId>`,
 * `/badge/<campId>`, `/perform/<code>` and `/volunteer/cert/<signupId>` each
 * render a named person's details to whoever holds the URL, those URLs are
 * mailed out and forwarded, and nothing prevented one of them becoming a search
 * result. §6 asserts the directive is present on every one of them, so deleting
 * it is a red build rather than a quiet regression nobody notices for a year.
 *
 * WHAT IT ASSERTS AGAINST: exported pure functions, plus structural rules read
 * as text for the things that live in route files. §7 runs the real sitemap
 * against the real database.
 *
 *   npm run verify:seo
 *   ENV_FILE=.env.test npm run verify:seo
 *
 * Sections 1-6 are pure and need no database. Section 7 does.
 */

import * as dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";

// Same preamble, same reason, as every other suite here: this machine has a
// global DATABASE_URL pointing at an unrelated project and dotenv will not
// override an already-set shell var without `override`. Every module under test
// is a dynamic `await import` below so Prisma is never constructed against the
// stale value.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Strip comment lines before grepping source, so prose cannot satisfy a check. */
function code(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

async function main(): Promise<void> {
  const seo = await import("../src/lib/seo");
  const { formatVenueIso } = await import("../src/lib/eventTime");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§1  slugs");

  eq("a plain name slugifies", seo.slugify("Dandiya Night"), "dandiya-night");
  eq(
    "diacritics decompose to ASCII rather than percent-encoding",
    seo.slugify("Rhythm of Navrātri"),
    "rhythm-of-navratri",
  );
  eq("punctuation collapses to single hyphens", seo.slugify("Garba  &  Dandiya!!"), "garba-dandiya");
  eq("leading and trailing separators are trimmed", seo.slugify("  --Diwali--  "), "diwali");
  eq("an all-symbol name yields an empty slug", seo.slugify("!!!"), "");

  eq(
    "an event slug is name then code",
    seo.eventSlug({ name: "Dandiya Night", code: "DN-2026" }),
    "dandiya-night-dn-2026",
  );
  // Two events whose NAMES are identical must not share a URL — this is the
  // whole reason the code is in the slug at all. A cultural org runs the same
  // festival every year with the same name.
  check(
    "same-named events in different years get different slugs",
    seo.eventSlug({ name: "Dandiya Night", code: "DN-2026" }) !==
      seo.eventSlug({ name: "Dandiya Night", code: "DN-2027" }),
    "two years of one festival collide on one URL",
  );
  eq(
    "a name already ending in the code does not repeat it",
    seo.eventSlug({ name: "Dandiya Night DN-2026", code: "DN-2026" }),
    "dandiya-night-dn-2026",
  );
  eq(
    "an unnameable event falls back to its code alone",
    seo.eventSlug({ name: "!!!", code: "DN-2026" }),
    "dn-2026",
  );

  const roster = [
    { name: "Dandiya Night", code: "DN-2026" },
    { name: "Rhythm of Navratri", code: "RON-2026" },
  ];
  eq(
    "the canonical slug resolves exactly",
    seo.resolveEventSlug(roster, "dandiya-night-dn-2026")?.exact,
    true,
  );
  const byCode = seo.resolveEventSlug(roster, "ron-2026");
  check(
    "a bare event code still resolves, but not as canonical",
    byCode?.event.code === "RON-2026" && byCode?.exact === false,
    JSON.stringify(byCode?.exact),
  );
  eq("an unknown slug resolves to null", seo.resolveEventSlug(roster, "no-such-event"), null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§2  venue parsing");

  // The shape every seeded event uses.
  eq(
    "\"Venue, Town, ST\" splits into name/locality/region",
    seo.parseVenue("McKamy Middle School, Flower Mound, TX"),
    {
      name: "McKamy Middle School",
      streetAddress: null,
      locality: "Flower Mound",
      region: "TX",
      postalCode: null,
    },
  );
  // The shape Event.location's own schema comment gives as the example.
  eq(
    "\"Venue, Street, Town ST\" also parses",
    seo.parseVenue("Town Common, Main St, Westborough MA"),
    {
      name: "Town Common",
      streetAddress: "Main St",
      locality: "Westborough",
      region: "MA",
      postalCode: null,
    },
  );
  eq(
    "a trailing ZIP is captured, not swallowed into the region",
    seo.parseVenue("Gerault Park, 1500 Gerault Rd, Flower Mound, TX 75028").postalCode,
    "75028",
  );
  // The refusal matters more than the parse: a GUESSED addressLocality is a
  // structured-data policy violation and, on a local-intent site, a wrong
  // answer to the only question being asked.
  eq(
    "an unparseable line yields no locality rather than a guess",
    seo.parseVenue("the usual place").locality,
    null,
  );
  eq(
    "…and keeps the whole line as the venue name",
    seo.parseVenue("the usual place").name,
    "the usual place",
  );
  eq("an empty location is not a locality", seo.parseVenue("").locality, null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3  primary locality");

  eq(
    "the most frequent town across listed events wins",
    seo.primaryLocality([
      "McKamy Middle School, Flower Mound, TX",
      "Gerault Park, Flower Mound, TX",
      "Somewhere Else, Plano, TX",
    ]),
    { locality: "Flower Mound", region: "TX" },
  );
  eq(
    "events with no parseable location contribute nothing",
    seo.primaryLocality(["the usual place", null, "Hall, Coppell, TX"]),
    { locality: "Coppell", region: "TX" },
  );
  eq("no parseable locations at all yields null", seo.primaryLocality([null, "somewhere"]), null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§4  offset-correct event dates");

  // Dandiya Night: 7:00 PM Oct 10 in Flower Mound. This is THE case. Serialised
  // as UTC it reads 2026-10-11T00:00:00Z — the next calendar day — and the date
  // is the thing a person reads in a search result.
  const dandiyaStart = new Date("2026-10-11T00:00:00Z");
  eq(
    "a 7 PM October event keeps its own calendar day",
    formatVenueIso(dandiyaStart),
    "2026-10-10T19:00:00-05:00",
  );
  check(
    "…which a UTC serialisation would have moved to the 11th",
    dandiyaStart.toISOString().startsWith("2026-10-11"),
    "the premise of this section no longer holds",
  );
  // CDT in summer, CST in winter, from the same function with no table.
  eq(
    "a June instant carries the daylight offset",
    formatVenueIso(new Date("2026-06-15T20:00:00Z")),
    "2026-06-15T15:00:00-05:00",
  );
  eq(
    "a December instant carries the standard offset",
    formatVenueIso(new Date("2026-12-15T20:00:00Z")),
    "2026-12-15T14:00:00-06:00",
  );
  check(
    "the offset is never a bare Z",
    !formatVenueIso(new Date("2026-06-15T20:00:00Z")).endsWith("Z"),
    "an offsetless timestamp reached the structured data",
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§5  JSON-LD");

  // Event names and descriptions are typed into an admin form. JSON.stringify
  // will happily emit the literal characters `</script>` inside a string, and
  // the HTML tokeniser ends the element there — it does not care that it is
  // inside JSON.
  const hostile = seo.jsonLdScript({ name: "</script><img src=x onerror=alert(1)>" });
  check(
    "a script-closing sequence in event copy cannot close the block",
    !hostile.includes("</script>") && !hostile.includes("<"),
    hostile,
  );
  eq(
    "…and the escaped form still parses back to the original string",
    JSON.parse(hostile).name,
    "</script><img src=x onerror=alert(1)>",
  );

  const ld = seo.eventLd({
    name: "Dandiya Night",
    url: "https://events.example.org/e/dandiya-night-dn-2026",
    description: "An evening of dandiya.",
    startDate: "2026-10-10T19:00:00-05:00",
    endDate: "2026-10-11T00:00:00-05:00",
    location: "McKamy Middle School, Flower Mound, TX",
    imageUrl: "https://events.example.org/events/dandiya.png",
    status: "OPEN",
    organizerName: "DCICA",
    offer: {
      priceCents: 1000,
      currency: "USD",
      url: "https://events.example.org/register?event=x",
      soldOut: false,
    },
  }) as Record<string, unknown>;

  // Google's Event documentation makes exactly these required. A missing one is
  // not a degraded rich result, it is no rich result.
  for (const required of ["name", "startDate", "location"]) {
    check(`Event JSON-LD carries required \`${required}\``, ld[required] !== undefined);
  }
  const place = ld.location as Record<string, unknown>;
  const addr = place.address as Record<string, unknown>;
  eq("the venue name is the venue, not the event", place.name, "McKamy Middle School");
  eq("the address carries the town", addr.addressLocality, "Flower Mound");
  eq("…and the state", addr.addressRegion, "TX");
  // Cents are a storage detail; schema.org wants a decimal string.
  eq("the offer price is decimal, not cents", (ld.offers as Record<string, unknown>).price, "10.00");
  eq(
    "an in-stock offering is advertised as available",
    (ld.offers as Record<string, unknown>).availability,
    "https://schema.org/InStock",
  );
  eq(
    "a sold-out offering says so",
    (
      seo.eventLd({
        name: "x", url: "u", description: null,
        startDate: "2026-10-10T19:00:00-05:00", endDate: "2026-10-11T00:00:00-05:00",
        location: "Hall, Coppell, TX", imageUrl: null, status: "OPEN", organizerName: "o",
        offer: { priceCents: 1000, currency: "USD", url: "u", soldOut: true },
      }) as unknown as Record<string, Record<string, unknown>>
    ).offers.availability,
    "https://schema.org/SoldOut",
  );
  // An unparseable venue must still produce the REQUIRED address property,
  // as plain text — weaker, but present and true.
  const vague = seo.eventLd({
    name: "x", url: "u", description: null,
    startDate: "2026-10-10T19:00:00-05:00", endDate: "2026-10-11T00:00:00-05:00",
    location: "the usual place", imageUrl: null, status: "OPEN", organizerName: "o", offer: null,
  }) as unknown as Record<string, Record<string, unknown>>;
  eq("an unparseable venue still emits a text address", vague.location.address, "the usual place");
  check(
    "an event with no sellable door advertises no offer",
    vague.offers === undefined,
    "a price was claimed for a door nobody can pay at",
  );
  // EventStatus has six values and none of them means cancelled; inferring one
  // would tell past attendees the event they went to never happened.
  eq(
    "a CLOSED event is still EventScheduled, never EventCancelled",
    (
      seo.eventLd({
        name: "x", url: "u", description: null,
        startDate: "2026-10-10T19:00:00-05:00", endDate: "2026-10-11T00:00:00-05:00",
        location: null, imageUrl: null, status: "CLOSED", organizerName: "o", offer: null,
      }) as Record<string, unknown>
    ).eventStatus,
    "https://schema.org/EventScheduled",
  );

  const orgLd = seo.organizationLd({
    orgName: "DCICA",
    seo: {},
    locality: { locality: "Flower Mound", region: "TX" },
    logoUrl: null,
  }) as Record<string, unknown>;
  eq("the org is an NGO, not a LocalBusiness", orgLd["@type"], "NGO");
  eq(
    "the derived town reaches the org address with no config",
    (orgLd.address as Record<string, unknown>).addressLocality,
    "Flower Mound",
  );
  eq("…and areaServed", orgLd.areaServed, ["Flower Mound, TX"]);
  check(
    "an org with no locatable events emits no address",
    (
      seo.organizationLd({ orgName: "X", seo: {}, locality: null, logoUrl: null }) as Record<
        string,
        unknown
      >
    ).address === undefined,
    "an address was invented for an org with no venues",
  );
  eq(
    "tenant settings override the derived locality",
    (
      seo.organizationLd({
        orgName: "X",
        seo: seo.resolveTenantSeo({ seo: { locality: "Edison", region: "NJ" } }),
        locality: { locality: "Flower Mound", region: "TX" },
        logoUrl: null,
      }) as unknown as Record<string, Record<string, unknown>>
    ).address.addressLocality,
    "Edison",
  );
  // A tax-status claim is the org's to make, never the platform's on its behalf.
  check(
    "no nonprofit tax status is claimed unless the tenant declared one",
    (seo.organizationLd({ orgName: "X", seo: {}, locality: null, logoUrl: null }) as Record<string, unknown>)
      .nonprofitStatus === undefined,
    "a 501(c)(3) claim was published for an org that never made it",
  );
  eq(
    "…and it is emitted once declared",
    (
      seo.organizationLd({
        orgName: "X",
        seo: seo.resolveTenantSeo({ seo: { nonprofitStatus: "Nonprofit501c3" } }),
        locality: null,
        logoUrl: null,
      }) as Record<string, unknown>
    ).nonprofitStatus,
    "Nonprofit501c3",
  );
  eq("a malformed settings.seo block degrades to empty", seo.resolveTenantSeo({ seo: { sameAs: ["not-a-url"] } }), {});

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§6  indexing directives (structural)");

  /**
   * Capability URLs: pages reachable by holding an opaque id, which render a
   * named person's details. Each must carry noindex, and each must NOT be
   * disallowed in robots.txt — a disallowed page is a page whose noindex is
   * never read, and these URLs leak by being mailed to the people they are for.
   */
  const CAPABILITY_PAGES = [
    "src/app/confirm/[orderId]/page.tsx",
    "src/app/badge/[campId]/page.tsx",
    "src/app/perform/[code]/page.tsx",
    "src/app/perform/after-payment/[orderId]/page.tsx",
    "src/app/volunteer/cert/[signupId]/page.tsx",
    "src/app/volunteer/confirm/[signupId]/page.tsx",
  ];
  const STAFF_PAGES = [
    "src/app/admin/layout.tsx",
    "src/app/dashboard/page.tsx",
    "src/app/station/[key]/page.tsx",
    "src/app/checkin/[campId]/page.tsx",
    "src/app/volunteers/page.tsx",
    "src/app/gate/page.tsx",
    "src/app/login/page.tsx",
    "src/app/test-login/page.tsx",
  ];
  for (const f of [...CAPABILITY_PAGES, ...STAFF_PAGES]) {
    const present = existsSync(f) && /export const metadata = PRIVATE_PAGE_METADATA;/.test(readFileSync(f, "utf8"));
    check(`${f.replace("src/app", "")} is noindex`, present, present ? "" : "missing directive");
  }

  const robotsSrc = code(readFileSync("src/app/robots.ts", "utf8"));
  for (const path of ["/confirm", "/badge", "/volunteer/cert", "/volunteer/confirm"]) {
    check(
      `robots.txt does NOT disallow ${path} (noindex must stay readable)`,
      !robotsSrc.includes(`"${path}`),
      "disallowing it guarantees the noindex is never crawled",
    );
  }
  check(
    "robots.txt still blocks the api and admin trees",
    robotsSrc.includes('"/api/"') && robotsSrc.includes('"/admin/"'),
    "the disallow list lost its machinery paths",
  );
  check(
    "robots.txt advertises the sitemap",
    /sitemap: absoluteUrl\("\/sitemap\.xml"\)/.test(robotsSrc),
    "Search Console has no sitemap to fetch",
  );

  // A build must not need a database. Two pages missing this declaration broke
  // every medcamp-prod deploy for weeks; a DB-reading sitemap is a far easier
  // way to reintroduce it.
  for (const f of ["src/app/sitemap.ts", "src/app/robots.ts", "src/app/e/[slug]/page.tsx"]) {
    check(
      `${f.replace("src/app", "")} declares force-dynamic`,
      /export const dynamic = "force-dynamic";/.test(readFileSync(f, "utf8")),
      "it would be prerendered, and a prerender opens a Prisma connection",
    );
  }

  const layoutSrc = code(readFileSync("src/app/layout.tsx", "utf8"));
  check(
    "the root layout sets metadataBase",
    /metadataBase: new URL\(siteUrl\(\)\)/.test(layoutSrc),
    "without it every canonical and OG url is emitted as a useless relative path",
  );
  check(
    "the root layout no longer hardcodes one tenant's name",
    !/title: "DCICA"/.test(layoutSrc),
    "a self-hoster's browser tab says somebody else's name",
  );

  // Parameter URLs must collapse to one canonical, or every event id in the
  // database becomes a separate indexable copy of the same form.
  for (const [f, canon] of [
    ["src/app/register/page.tsx", "/register"],
    ["src/app/perform/page.tsx", "/perform"],
    ["src/app/volunteer/page.tsx", "/volunteer"],
    ["src/app/vendors/page.tsx", "/vendors"],
  ] as const) {
    check(
      `${canon} canonicalises its ?event= variants`,
      new RegExp(`alternates: \\{ canonical: "${canon}" \\}`).test(readFileSync(f, "utf8")),
      "each event id becomes its own indexable duplicate",
    );
  }

  // Every public page needs exactly one h1 — /vendors had none at all.
  for (const f of [
    "src/app/page.tsx",
    "src/app/register/page.tsx",
    "src/app/perform/page.tsx",
    "src/app/volunteer/page.tsx",
    "src/app/vendors/page.tsx",
    "src/app/e/[slug]/page.tsx",
  ]) {
    check(`${f.replace("src/app", "")} renders an h1`, /<h1/.test(readFileSync(f, "utf8")));
  }

  // The companion line ("Same evening as X · open floor") is computed by
  // comparing an event against its SIBLINGS. The event page originally passed
  // saleSummaryByEvent a one-element array, so the comparison had nothing to
  // compare against and the line silently never rendered — no error, no empty
  // element, nothing to notice. Structural, because reproducing it live means
  // two scratch events in one gym on one night.
  const eventPageSrc = code(readFileSync("src/app/e/[slug]/page.tsx", "utf8"));
  check(
    "the event page gives saleSummaryByEvent that evening's other events",
    /saleSummaryByEvent\(sameDay, now\)/.test(eventPageSrc) &&
      /dayKey\(c\.startsAt\) === thisDay/.test(eventPageSrc),
    "a one-event list can never produce the same-evening line",
  );

  // The event page has to be reachable by a crawler for the sitemap to mean
  // anything — an orphan URL is a weak signal however often it is submitted.
  check(
    "the rail links each poster to that event's own page",
    /href=\{`\/e\/\$\{eventSlug\(e\)\}`\}/.test(
      readFileSync("src/app/_components/EventPosterCard.tsx", "utf8"),
    ),
    "/e/<slug> is orphaned",
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n\u00a77  the deployment-wide indexing switch");

  /**
   * test.dcica.org is a fully public, fully working copy of the storefront on
   * test-mode Stripe. Indexed, it competes with events.dcica.org for the exact
   * local queries this whole change targets, and it can win: same content on a
   * shorter host. The failure is not a ranking loss. It is a neighbour
   * searching "dandiya night flower mound", landing on the test site, and
   * completing a checkout that takes no money and issues no ticket.
   *
   * Structural, because the flag is read from env and re-importing the route
   * modules under a mutated env inside one process fights both the dotenv
   * preamble and the import cache.
   */
  const robotsFile = code(readFileSync("src/app/robots.ts", "utf8"));
  check(
    "robots.txt refuses every crawler when indexing is off",
    /if \(!searchIndexingEnabled\(\)\)/.test(robotsFile) &&
      /userAgent: "\*", disallow: "\/"/.test(robotsFile),
    "a test storefront would invite the crawl",
  );
  check(
    "the sitemap is empty when indexing is off",
    /if \(!searchIndexingEnabled\(\)\) return \[\];/.test(
      code(readFileSync("src/app/sitemap.ts", "utf8")),
    ),
    "a non-indexable deployment still advertised its urls",
  );
  check(
    "\u2026and every page goes noindex, the public ones included",
    /robots: searchIndexingEnabled\(\)/.test(code(readFileSync("src/app/layout.tsx", "utf8"))),
    "robots.txt alone does not deindex anything already crawled",
  );
  eq("indexing defaults to ON so a lone self-hoster needs no config", seo.searchIndexingEnabled(), true);

  console.log("\n\u00a78  the real sitemap");

  const sitemap = (await import("../src/app/sitemap")).default;
  const entries = await sitemap();
  const urls = entries.map((e) => String(e.url));

  check("the sitemap is non-empty", urls.length > 0, `${urls.length} urls`);
  for (const p of ["/", "/register", "/perform", "/volunteer", "/vendors"]) {
    const want = p === "/" ? null : p;
    check(
      `it lists ${p}`,
      urls.some((u) => (want ? u.endsWith(want) : /^https?:\/\/[^/]+\/$/.test(u))),
    );
  }
  check(
    "every url is absolute",
    urls.every((u) => /^https?:\/\//.test(u)),
    urls.find((u) => !/^https?:\/\//.test(u)) ?? "",
  );
  check(
    "no url is duplicated",
    new Set(urls).size === urls.length,
    `${urls.length - new Set(urls).size} duplicate(s)`,
  );
  // A sitemap is a request to index. None of these may ever be in one.
  const FORBIDDEN = ["/admin", "/dashboard", "/confirm/", "/badge/", "/station/", "/gate", "/login", "/api/", "/cert/"];
  const leaked = urls.filter((u) => FORBIDDEN.some((f) => u.includes(f)));
  eq("no private path is submitted for indexing", leaked, []);

  const eventUrls = urls.filter((u) => u.includes("/e/"));
  console.log(`      (${eventUrls.length} event url(s) in this environment)`);
  if (eventUrls.length > 0) {
    check(
      "event urls are slugs, not raw cuids",
      eventUrls.every((u) => !/\/e\/c[a-z0-9]{20,}$/.test(u)),
      eventUrls[0],
    );
    // Round-trip: the slug in the sitemap must be the slug the page resolves.
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    try {
      const evs = await db.event.findMany({
        where: { status: { not: "DRAFT" } },
        select: { name: true, code: true },
      });
      const bad = eventUrls.filter((u) => {
        const slug = u.split("/e/")[1];
        return seo.resolveEventSlug(evs, slug)?.exact !== true;
      });
      eq("every event url in the sitemap resolves to its own page", bad, []);
    } finally {
      await db.$disconnect();
    }
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
