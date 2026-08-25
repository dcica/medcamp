import Image from "next/image";
import Link from "next/link";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getActiveOrg, getActiveBranding } from "@/lib/tenant";
import { offeringKindsByEvent } from "@/server/performance";
import { saleSummaryByEvent } from "@/server/eventSales";
import { eventActions, TYPE_LABEL } from "@/lib/eventActions";
import {
  formatWhen,
  formatVenueMonthDay,
  formatVenueIso,
  instantToVenueInput,
} from "@/lib/eventTime";
import {
  absoluteUrl,
  breadcrumbLd,
  eventLd,
  eventSlug,
  parseVenue,
  resolveEventSlug,
} from "@/lib/seo";
import { JsonLd } from "@/app/_components/JsonLd";

export const dynamic = "force-dynamic";

/**
 * One event, on its own indexable URL.
 *
 * ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────
 *
 * Not because the rail on `/` was insufficient — it is the better way to browse
 * four events on a phone, and it stays. This exists because of a hard
 * constraint on the other side: Google's event experience "only supports pages
 * that focus on a single event". A rail of four is one page about four things,
 * and no amount of markup makes it eligible.
 *
 * That eligibility is the entire local-search proposition for an org like this
 * one. The person worth reaching is in Lewisville, has never heard of DCICA,
 * and types "garba near me" — they will never search the org's name, so ranking
 * for it is worth nothing. The events carousel is the surface that answers that
 * query, and a per-event URL is its entry fee.
 *
 * Everything here is composed from parts the rail already uses — `eventActions`
 * for the doors, `saleSummaryByEvent` for the price, `formatWhen` for the time.
 * Nothing about an event is stated twice in two places, so the page and the card
 * cannot drift apart. The one thing this page adds is the structured data.
 */

/**
 * Load an event by slug, once per request.
 *
 * `cache` because Next calls `generateMetadata` and the component separately and
 * both need the same event; without it every event page runs its queries twice.
 *
 * The candidate list is fetched whole and matched in memory because the slug is
 * DERIVED from name + code (see `eventSlug`) and there is no slug column to
 * query. That is tens of rows for any real tenant. If an org ever has enough
 * events for this to matter, the fix is a stored slug column and a migration,
 * not a cleverer query.
 */
const loadEvent = cache(async (slug: string) => {
  const org = await getActiveOrg();
  if (!org) return null;

  // DRAFT excluded: an unannounced event must not be reachable by guessing its
  // name. Everything else is public, including finished events — a page for
  // last year's Diwali is the honest answer to somebody searching for it.
  const candidates = await db.event.findMany({
    where: { orgId: org.id, status: { not: "DRAFT" } },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      status: true,
      startsAt: true,
      endsAt: true,
      location: true,
      description: true,
      imageUrl: true,
      externalUrl: true,
      externallyHosted: true,
      hostedByName: true,
      honorsMembership: true,
      offersRegistration: true,
      offersVendors: true,
      offersVolunteers: true,
    },
    orderBy: { startsAt: "desc" },
  });

  const hit = resolveEventSlug(candidates, slug);
  return hit ? { ...hit, org, candidates } : null;
});

/** Venue-correct calendar year, for a title that reads "Oct 10, 2026". */
function venueYear(instant: Date): string {
  return instantToVenueInput(instant).slice(0, 4);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hit = await loadEvent(slug);
  if (!hit) return { title: "Event not found", robots: { index: false, follow: false } };

  const e = hit.event;
  const venue = e.location ? parseVenue(e.location) : null;
  const when = `${formatVenueMonthDay(e.startsAt)}, ${venueYear(e.startsAt)}`;

  // The town goes in the TITLE, not just the body, and that is the whole local
  // play in one line. A title is the strongest signal a page gives about what
  // it is about, and the query being competed for is "<thing> <town>" — the
  // person searching supplies the town, so the page had better contain it.
  const where = venue?.locality
    ? `${venue.locality}, ${venue.region ?? ""}`.replace(/, $/, "")
    : null;
  const title = [e.name, when, where].filter(Boolean).join(" · ");

  const description =
    e.description?.trim() ||
    [
      `${TYPE_LABEL[e.type] ?? "Event"} hosted by ${hit.org.name}`,
      where ? `in ${where}` : null,
      `on ${when}.`,
      e.location ? `Venue: ${e.location}.` : null,
      "Tickets, entry and volunteer signup online.",
    ]
      .filter(Boolean)
      .join(" ");

  const canonical = `/e/${eventSlug(e)}`;
  const image = e.imageUrl ? [e.imageUrl] : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteUrl(canonical),
      images: image,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image,
    },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hit = await loadEvent(slug);
  if (!hit) notFound();

  const e = hit.event;

  // The slug matched on the event CODE rather than the full name+code. Send the
  // reader to the canonical URL rather than serving the same page at two
  // addresses — one page, one URL, or Google splits its signals across both.
  if (!hit.exact) permanentRedirect(`/e/${eventSlug(e)}`);

  const now = new Date();
  const branding = await getActiveBranding();

  // The event PLUS anything else on the same venue day.
  //
  // Passing this event alone was a real bug and a silent one: the "Same evening
  // as Rhythm of Navratri · open floor" line is computed by comparing an event
  // against its SIBLINGS, so a list of one can never produce it, and the line
  // simply never rendered — no error, no empty element, nothing to notice. The
  // rail gets it right by accident, because it happens to pass every listed
  // event at once.
  //
  // Filtered to the same venue day rather than passing the whole roster,
  // because `saleSummaryByEvent` reads the offerings of everything it is given
  // and an org with years of past events would drag all of them into one query
  // to answer a question only about tonight. Same venue-day key the pairing
  // itself uses.
  const dayKey = (d: Date) => instantToVenueInput(d).slice(0, 10);
  const thisDay = dayKey(e.startsAt);
  const sameDay = hit.candidates
    .filter((c) => dayKey(c.startsAt) === thisDay)
    .map((c) => ({ id: c.id, name: c.name, startsAt: c.startsAt, location: c.location }));

  const [kindsMap, sales] = await Promise.all([
    offeringKindsByEvent([e.id]),
    saleSummaryByEvent(sameDay, now),
  ]);
  const kinds = kindsMap.get(e.id);
  const sale = sales.get(e.id);
  const actions = eventActions(e, kinds);
  const primary = actions[0];
  // Same rule the card applies, and for the same reason: a price is only honest
  // when there is a door to pay it at. See EventPosterCard for the live case.
  const sellable = primary?.key === "register" || primary?.key === "perform";

  const canonical = `/e/${eventSlug(e)}`;
  const isPast = e.endsAt < now;

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <JsonLd
        data={eventLd({
          name: e.name,
          url: absoluteUrl(canonical),
          description: e.description,
          // Offset-correct, never toISOString — a 7 PM event serialised as UTC
          // lands on the following calendar day, and the date is what a person
          // reads in the search result.
          startDate: formatVenueIso(e.startsAt),
          endDate: formatVenueIso(e.endsAt),
          location: e.location,
          imageUrl: e.imageUrl ? absoluteUrl(e.imageUrl) : null,
          status: e.status,
          organizerName: e.externallyHosted
            ? (e.hostedByName ?? branding.orgName)
            : branding.orgName,
          // Only claim an offer when there is a door to buy it at, so the
          // structured data cannot advertise a price the page itself refuses to
          // print.
          offer:
            sellable && sale?.offer && primary
              ? {
                  priceCents: sale.offer.priceCents,
                  currency: sale.offer.currency,
                  url: absoluteUrl(primary.href),
                  soldOut: sale.offer.soldOut,
                }
              : null,
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Events", url: absoluteUrl("/") },
          { name: e.name, url: absoluteUrl(canonical) },
        ])}
      />

      <nav className="text-sm">
        <Link href="/" className="text-brand underline">
          ← All events
        </Link>
      </nav>

      {e.imageUrl ? (
        <div className="relative mt-4 aspect-[3/4] overflow-hidden rounded-xl bg-gray-100">
          <Image
            src={e.imageUrl}
            alt={`${e.name} poster`}
            fill
            sizes="(min-width: 640px) 640px, 100vw"
            className="object-cover"
            priority
          />
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {TYPE_LABEL[e.type] ?? "Event"}
          {e.status === "ACTIVE" && " · Happening now"}
        </p>
        {/* The one h1 on the page, and it is the event's real name — this is the
            page's whole subject, so it is not sr-only the way the rail's is. */}
        <h1 className="mt-1 text-2xl font-bold leading-tight">{e.name}</h1>
        <p className="mt-2 text-sm font-medium text-gray-800">
          {formatWhen(e.startsAt, e.endsAt)}
        </p>
        {e.location && (
          <p className="mt-1 text-sm leading-snug text-gray-600">{e.location}</p>
        )}
        {e.externallyHosted && e.hostedByName && (
          <p className="mt-1 text-sm text-gray-600">
            Community booth at an event hosted by {e.hostedByName}
          </p>
        )}
      </div>

      {isPast && (
        // Stated rather than hidden. This page stays reachable for people
        // searching last year's event, and the worst outcome is one of them
        // turning up at an empty gym because nothing said the date had passed.
        <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          This event has finished.{" "}
          <Link href="/" className="text-brand underline">
            See what&apos;s coming up
          </Link>
          .
        </p>
      )}

      {e.description && (
        <p className="mt-4 text-sm leading-relaxed text-gray-700">
          {e.description}
        </p>
      )}

      {!isPast && (
        <div className="mt-4 space-y-1.5">
          {sale?.sameEveningAs && (
            <p className="text-sm text-gray-600">
              Same evening as {sale.sameEveningAs.name}
              {sale.sameEveningAs.openFloor ? " · open floor" : ""}
            </p>
          )}
          {sellable && sale?.priceLine && (
            <p className="text-base font-semibold text-gray-900">
              {sale.priceLine}
            </p>
          )}
          {sellable && sale?.capacityLine && (
            <p className="text-sm font-semibold text-gray-700">
              {sale.capacityLine}
            </p>
          )}
          {e.honorsMembership && (
            <p className="text-sm text-gray-600">Members get in free</p>
          )}
        </div>
      )}

      {!isPast && actions.length > 0 && (
        <div className="mt-6 space-y-2">
          {actions.map((a, i) => (
            <Link
              key={a.key}
              href={a.href}
              className={
                i === 0
                  ? "flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
                  : "flex min-h-tap items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {e.externalUrl && (
        <p className="mt-4 text-sm">
          <a
            href={e.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline"
          >
            Official event page
          </a>
        </p>
      )}
    </main>
  );
}
