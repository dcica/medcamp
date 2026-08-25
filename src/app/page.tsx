import { cache } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { offeringKindsByEvent } from "@/server/performance";
import { saleSummaryByEvent } from "@/server/eventSales";
import { getActiveOrg } from "@/lib/tenant";
import { organizationLd, primaryLocality, resolveTenantSeo } from "@/lib/seo";
import { formatVenueMonthDay } from "@/lib/eventTime";
import { JsonLd } from "@/app/_components/JsonLd";
import { EmptyEventsState } from "@/app/_components/EmptyEventsState";
import { EventRail } from "@/app/_components/EventRail";
import { EventExtras } from "@/app/_components/EventExtras";
import {
  EventPosterCard,
  type PosterEvent,
} from "@/app/_components/EventPosterCard";

export const dynamic = "force-dynamic";

/**
 * Public landing. A rail of the upcoming events as poster cards, each with one
 * primary action and a resolved price/urgency line. This is the only public
 * event listing — the separate /events route is gone, and the staff module index
 * lives behind the signed-in menu in SiteHeader.
 *
 * What this replaced, and why: a hero-plus-grid that named an event and its date
 * and then offered up to four equally-weighted buttons, with no price anywhere
 * on the page. Roughly 130px of a 667px phone screen went by before the first
 * poster — a subhead repeating what the buttons already said, and a PageHelp
 * toggle whose open state is sticky in localStorage, so one tap pinned three
 * paragraphs above the fold on every future visit. PageHelp stays everywhere it
 * explains a decision (/register, /perform, /volunteer, the gate, check-in); it
 * does not belong on a page whose controls name themselves.
 */

type EventRow = PosterEvent;

/**
 * The org and its listed events, resolved once per request.
 *
 * `cache` because `generateMetadata` and the component both need exactly this,
 * and Next calls them separately — without it the front door, the single
 * most-requested page on the site, would run its event query twice per hit.
 */
const loadHome = cache(async () => {
  const org = await getActiveOrg();
  const events: EventRow[] = org
    ? await db.event.findMany({
        // `endsAt`, not `startsAt`: an event in progress stays listed for the
        // crowd already in the room. Status alone is set by hand and drifts —
        // a finished event stayed here for six weeks with a live CTA.
        //
        // No `take`: the rail scrolls, so a fifth event needs no cap.
        where: {
          orgId: org.id,
          status: { in: ["OPEN", "ACTIVE"] },
          endsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
      })
    : [];
  return { org, events };
});

/**
 * The front door's title and description, WRITTEN FROM THE DATA.
 *
 * The instinct is a hand-written line naming garba and Diwali, and it is the
 * wrong instinct twice over. It would rot — the events change every season and
 * the copy would not — and it would hardcode one tenant's festivals into a
 * platform that is meant to be self-hosted by any non-profit.
 *
 * The events already ARE the keywords. Listing their real names and the town
 * they are held in produces exactly the phrases a local searcher types
 * ("dandiya night flower mound"), stays true by construction, and costs a
 * second tenant nothing. An org with no events gets the plain form rather than
 * a promise about events that do not exist.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { org, events } = await loadHome();
  const orgName = org?.name ?? "Community events";
  const local = primaryLocality(events.map((e) => e.location));
  const where = local ? `${local.locality}, ${local.region}` : null;

  const title = where
    ? `${orgName} events in ${where}`
    : `${orgName} — upcoming events`;

  const listed = events
    .slice(0, 4)
    .map((e) => `${e.name} (${formatVenueMonthDay(e.startsAt)})`)
    .join(", ");

  const description = events.length
    ? `Upcoming ${orgName} events${where ? ` in ${where}` : ""}: ${listed}. ` +
      `Buy tickets, enter a performance or sign up to volunteer.`
    : `Tickets, registration and volunteer signup for ${orgName}${where ? ` in ${where}` : ""}.`;

  return {
    // `absolute` so the root layout's "%s · <org>" template does not append the
    // org name to a title that already opens with it.
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", title, description, url: "/" },
  };
}

export default async function Home() {
  const { org, events } = await loadHome();

  // One `now` for the whole render, so two cards can never resolve opposite
  // sides of the same early-bird deadline.
  const now = new Date();
  const [offeringKinds, sales] = await Promise.all([
    offeringKindsByEvent(events.map((e) => e.id)),
    saleSummaryByEvent(events, now),
  ]);

  const orgName = org?.name ?? "DCICA platform";
  const local = primaryLocality(events.map((e) => e.location));

  return (
    <main className="mx-auto max-w-screen-md px-4 py-4">
      {/* The org itself, once, on its front door — the page every other page
          and every external link points at, which is what makes it the right
          host for the identity block rather than the layout. */}
      <JsonLd
        data={organizationLd({
          orgName,
          seo: resolveTenantSeo(org?.settings),
          locality: local,
          logoUrl: null,
        })}
      />

      {/* sr-only, not deleted: the visible wordmark is three lines above in
          SiteHeader, so showing it again was the same word twice on a 375px
          screen. A page still needs one h1 for screen readers and search.
          It names the TOWN when the events say what the town is — an h1 is the
          page's strongest on-page subject signal and "upcoming events" alone
          competes with every other org in the country for it. */}
      <h1 className="sr-only">
        {local
          ? `${orgName} — upcoming events in ${local.locality}, ${local.region}`
          : `${orgName} — upcoming events`}
      </h1>

      {events.length > 0 ? (
        <>
          <EventRail labels={events.map((e) => e.name)}>
            {events.map((e, i) => (
              <EventPosterCard
                key={e.id}
                event={e}
                kinds={offeringKinds.get(e.id)}
                sale={sales.get(e.id)}
                // Only the first poster is above the fold; preloading the rest
                // would fight the rail for bandwidth on a phone.
                priority={i === 0}
              />
            ))}
          </EventRail>

          <EventExtras events={events} kinds={offeringKinds} />

          {/* TODO: a "Find my ticket" link belongs here, but there is no lookup
              route yet and a dead link is worse than none. */}
        </>
      ) : (
        // The empty state, and nothing more. The front door does not get a
        // past-events section: a landing page leading with events that are over
        // is worse than one leading with nothing.
        <EmptyEventsState />
      )}
    </main>
  );
}
