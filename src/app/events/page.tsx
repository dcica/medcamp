import Link from "next/link";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { EventBanner } from "@/app/_components/EventBanner";
import { EmptyEventsState } from "@/app/_components/EmptyEventsState";

export const dynamic = "force-dynamic";

/**
 * Public events landing (general events module). Lists the org's upcoming events
 * — anything OPEN or currently ACTIVE — in a dcica.org-style image card. The
 * action buttons per event are config-driven: a camp shows Register; a town
 * event we only attend shows Volunteer only; a community event shows vendor +
 * volunteer. See Event.offers* flags.
 */

const TYPE_LABEL: Record<string, string> = {
  CAMP: "Medical camp",
  GENERAL: "Event",
  MEMBERSHIP_DRIVE: "Membership",
};

// Primary registration wording by event type.
const REGISTER_LABEL: Record<string, string> = {
  CAMP: "Register",
  GENERAL: "Buy tickets",
  MEMBERSHIP_DRIVE: "Join or renew",
};

function formatWhen(start: Date, end: Date): string {
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
  const time = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${date.format(start)} · ${time.format(start)} – ${time.format(end)}`
    : `${date.format(start)} – ${date.format(end)}`;
}

// Finished events get the day only. Door times are instructions, and an
// instruction on something that already happened is just noise.
function formatDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);
}

/**
 * How long a finished event stays on the public list.
 *
 * Stands in for the archive the design assumes: there is no `archived` flag, no
 * archive route and nowhere for an old event to move to, so instead of moving it
 * we stop rendering it. 180 days is one half of the org's annual cycle — long
 * enough that the season just gone is still here (the Diwali-to-Holi gap is
 * ~4.5 months), short enough that the same annual event never shows up twice and
 * the section never quietly becomes the archive it is standing in for.
 */
const PAST_EVENT_WINDOW_DAYS = 180;

/**
 * Checked-in headcount per event, for the past list only.
 *
 * One grouped read rather than N calls into `getEventHeadcount` — that helper is
 * single-event and belongs to the gate. Note this counts raw scans; Task E4 will
 * redefine the same metric as admission line items, because a receipt-only
 * attendee inflates a scan count.
 */
async function countCheckedIn(
  orgId: string,
  eventIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (eventIds.length === 0) return counts;
  const rows = await db.attendee.groupBy({
    by: ["eventId"],
    where: { orgId, eventId: { in: eventIds }, checkedInAt: { not: null } },
    _count: { _all: true },
  });
  for (const r of rows) counts.set(r.eventId, r._count._all);
  return counts;
}

export default async function EventsPage() {
  const org = await getActiveOrg();
  const now = new Date();
  const events = org
    ? await db.event.findMany({
        // `endsAt`, not `startsAt`: an event in progress stays listed for the
        // crowd already in the room. Status alone is set by hand and drifts —
        // a finished event stayed here for six weeks with a live CTA.
        where: {
          orgId: org.id,
          status: { in: ["OPEN", "ACTIVE"] },
          endsAt: { gte: now },
        },
        orderBy: { startsAt: "asc" },
      })
    : [];

  // Deliberately a second query, not a widening of the one above. If the two
  // shared a result set, one refactor that forgot to re-split it would put a
  // finished event back among the sellable cards — which is the exact defect
  // that made this section necessary.
  const past = org
    ? await db.event.findMany({
        where: {
          orgId: org.id,
          endsAt: {
            lt: now,
            gte: new Date(now.getTime() - PAST_EVENT_WINDOW_DAYS * 86_400_000),
          },
          // ACTIVE is excluded on purpose even when the scheduled end time has
          // passed: ACTIVE means staff are still working the door, and the gate
          // will keep scanning past a run-over end time. Thanking a crowd for
          // coming to an event the gate is still admitting people to would have
          // the public page contradict the door. DRAFT never went public at all,
          // so it has nothing to be remembered for.
          status: { in: ["OPEN", "CLOSED", "PURGEABLE", "PURGED"] },
        },
        orderBy: { endsAt: "desc" }, // most recently finished first
      })
    : [];
  const pastAttendance = org
    ? await countCheckedIn(
        org.id,
        past.map((e) => e.id),
      )
    : new Map<string, number>();

  return (
    <main className="mx-auto max-w-screen-md px-4 py-8">
      <PageHelp
        id="events"
        title="Upcoming events"
        subtitle="Register for a camp, buy tickets, or sign up as a vendor or volunteer."
        items={[
          {
            label: "Register / Buy tickets",
            body: "Opens the registration portal for that event. You'll get a QR badge by email after payment.",
          },
          {
            label: "Vendors",
            body: "Selling or sponsoring at an event? Tell us what you offer and we'll follow up with a booth.",
          },
          {
            label: "Volunteers",
            body: "Want to help run an event? Sign up and a coordinator will confirm your role and shift.",
          },
        ]}
      />

      {events.length === 0 ? (
        <EmptyEventsState
          pastEventsHref={past.length > 0 ? "#past" : undefined}
        />
      ) : (
        // items-start: cards size to their own content. Without it a grid row
        // stretches every card to match its tallest sibling, and the mt-auto
        // action block below turns that slack into dead white space — a poster
        // card next to a text-only card opened a 238px void.
        <ul className="mt-8 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          {events.map((e) => {
            // Config-driven action set. First entry is the card's primary CTA.
            const actions: { key: string; label: string; href: string }[] = [];
            if (e.offersRegistration)
              actions.push({
                key: "register",
                label: REGISTER_LABEL[e.type] ?? "Register",
                href: `/register?event=${e.id}`,
              });
            if (e.offersVolunteers)
              actions.push({
                key: "volunteer",
                label: "Volunteer",
                href: `/volunteer?event=${e.id}`,
              });
            if (e.offersVendors)
              actions.push({
                key: "vendor",
                label: "Register as vendor",
                href: `/vendors?event=${e.id}`,
              });

            const [primary, ...secondary] = actions;

            return (
              <li
                key={e.id}
                className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
              >
                {e.imageUrl && <EventBanner src={e.imageUrl} alt={e.name} />}

                {/* Saffron title/date panel — mirrors dcica.org's events design. */}
                <div className="bg-accent px-4 py-3 text-accent-fg">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
                      {e.externallyHosted ? "Community booth" : TYPE_LABEL[e.type] ?? "Event"}
                    </span>
                    {e.status === "ACTIVE" && (
                      <span className="rounded-full bg-accent2 px-2 py-0.5 text-xs font-semibold text-accent2-fg">
                        Happening now
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-lg font-bold leading-tight">
                    {e.name}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium">
                    {formatWhen(e.startsAt, e.endsAt)}
                  </p>
                  {e.location && (
                    <p className="mt-0.5 text-sm font-medium opacity-90">
                      {e.location}
                      {e.externallyHosted && e.hostedByName
                        ? ` · hosted by ${e.hostedByName}`
                        : ""}
                    </p>
                  )}
                </div>

                <div className="mt-auto space-y-2 p-4">
                  {e.description && (
                    <p className="text-sm text-gray-600">{e.description}</p>
                  )}
                  {primary && (
                    <Link
                      href={primary.href}
                      className="flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
                    >
                      {primary.label}
                    </Link>
                  )}
                  {secondary.length > 0 && (
                    <div
                      className={
                        secondary.length > 1
                          ? "grid grid-cols-2 gap-2"
                          : "grid grid-cols-1"
                      }
                    >
                      {secondary.map((a) => (
                        <Link
                          key={a.key}
                          href={a.href}
                          className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
                        >
                          {a.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Past events. Subordinate by every available signal — muted surface, no
          poster, no saffron panel, smaller type — because the one thing a
          finished event must never look like is something you can still act on.
          There is not a single link inside a card here, deliberately. */}
      {past.length > 0 && (
        <section id="past" className="mt-12 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Recently finished
          </h2>
          {/* Once, on the section — this is the sentence that stops someone
              turning up with an old QR code, and it stops being read if it is
              stamped on every card. */}
          <p className="mt-1 text-sm text-gray-500">
            Tickets for past events no longer scan.
          </p>

          <ul className="mt-4 grid grid-cols-1 gap-3">
            {past.map((e) => {
              const came = pastAttendance.get(e.id) ?? 0;
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {e.externallyHosted
                        ? "Community booth"
                        : TYPE_LABEL[e.type] ?? "Event"}
                    </span>
                    <span className="text-xs font-medium text-gray-400">
                      Finished
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold leading-tight text-gray-700">
                    {e.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {formatDay(e.startsAt)}
                    {e.location ? ` · ${e.location}` : ""}
                    {e.externallyHosted && e.hostedByName
                      ? ` · hosted by ${e.hostedByName}`
                      : ""}
                  </p>
                  {/* Only claimed when there is a real number behind it. The
                      org's community events are not ticketed and nobody scans
                      in, so the count is legitimately zero there — and "0 people
                      came — thank you" would be the page insulting the event. */}
                  {came > 0 && (
                    <p className="mt-1 text-sm font-medium text-gray-600">
                      {came === 1 ? "1 person came" : `${came} people came`} —
                      thank you.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
