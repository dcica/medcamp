import { db } from "@/lib/db";
import { offeringKindsByEvent } from "@/server/performance";
import { saleSummaryByEvent } from "@/server/eventSales";
import { getActiveOrg } from "@/lib/tenant";
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

export default async function Home() {
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

  // One `now` for the whole render, so two cards can never resolve opposite
  // sides of the same early-bird deadline.
  const now = new Date();
  const [offeringKinds, sales] = await Promise.all([
    offeringKindsByEvent(events.map((e) => e.id)),
    saleSummaryByEvent(events, now),
  ]);

  const orgName = org?.name ?? "DCICA platform";

  return (
    <main className="mx-auto max-w-screen-md px-4 py-4">
      {/* sr-only, not deleted: the visible wordmark is three lines above in
          SiteHeader, so showing it again was the same word twice on a 375px
          screen. A page still needs one h1 for screen readers and search. */}
      <h1 className="sr-only">{orgName} — upcoming events</h1>

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
