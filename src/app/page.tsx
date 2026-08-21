import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  offeringKindsByEvent,
  type EventOfferingKinds,
} from "@/server/performance";
import { getActiveOrg } from "@/lib/tenant";
import { formatWhen } from "@/lib/eventTime";
import { PageHelp } from "@/app/_components/PageHelp";
import { EmptyEventsState } from "@/app/_components/EmptyEventsState";

export const dynamic = "force-dynamic";

/**
 * Public landing. Leads with the org's upcoming events — the soonest one is
 * featured as a hero with its full action set (register/buy tickets, volunteer,
 * vendor), the rest follow in a grid. Action buttons per event are config-driven
 * (Event.offers* flags), matching /events. The staff module index is no longer
 * shown here — it lives behind the signed-in menu in SiteHeader.
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

type EventRow = {
  id: string;
  type: string;
  status: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  imageUrl: string | null;
  offersRegistration: boolean;
  offersVendors: boolean;
  offersVolunteers: boolean;
};

// Config-driven action set for an event. First entry is the primary CTA.
function eventActions(e: EventRow, kinds?: EventOfferingKinds) {
  const actions: { key: string; label: string; href: string }[] = [];
  // Mirrors /events — see the reasoning on the CTA split there.
  if (e.offersRegistration && kinds?.hasFee)
    actions.push({
      key: "perform",
      label: "Enter a performance",
      href: `/perform?event=${e.id}`,
    });
  if (e.offersRegistration && (kinds?.hasOther ?? true))
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
  return actions;
}

export default async function Home() {
  const org = await getActiveOrg();
  const events: EventRow[] = org
    ? await db.event.findMany({
        // `endsAt`, not `startsAt`: an event in progress stays listed for the
        // crowd already in the room. Status alone is set by hand and drifts —
        // a finished event stayed here for six weeks with a live CTA.
        where: {
          orgId: org.id,
          status: { in: ["OPEN", "ACTIVE"] },
          endsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
      })
    : [];

  const offeringKinds = await offeringKindsByEvent(events.map((e) => e.id));

  const [featured, ...rest] = events;
  const orgName = org?.name ?? "DCICA platform";

  return (
    <main className="mx-auto max-w-screen-md px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-brand">{orgName}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Register for an event, buy tickets, or sign up to volunteer or set up
          to be a vendor.
        </p>
      </header>

      <PageHelp
        id="home"
        items={[
          {
            label: "Register / Buy tickets",
            body: "Opens registration for that event. You'll get a QR badge by email after payment.",
          },
          {
            label: "Volunteer",
            body: "Want to help run an event? Sign up and a coordinator will confirm your role and shift.",
          },
          {
            label: "Vendors",
            body: "Selling or sponsoring? Tell us what you offer and we'll follow up with a booth.",
          },
        ]}
      />

      {featured ? (
        <>
          {/* Featured (soonest) event — full-bleed hero with its action set. */}
          <FeaturedEvent event={featured} kinds={offeringKinds.get(featured.id)} />

          {rest.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                More upcoming events
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                {rest.map((e) => (
                  <EventCard key={e.id} event={e} kinds={offeringKinds.get(e.id)} />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        // Same empty state as /events, and nothing more. The front door does not
        // get a past-events section: a landing page leading with events that are
        // over is worse than one leading with nothing.
        <EmptyEventsState />
      )}
    </main>
  );
}

function FeaturedEvent({
  event: e,
  kinds,
}: {
  event: EventRow;
  kinds?: EventOfferingKinds;
}) {
  const actions = eventActions(e, kinds);
  const [primary, ...secondary] = actions;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border-2 border-accent bg-white shadow-sm">
      {e.imageUrl && (
        <div className="relative aspect-[16/9] bg-gray-100">
          <Image
            src={e.imageUrl}
            alt={e.name}
            fill
            sizes="(min-width: 768px) 768px, 100vw"
            className="object-cover"
            priority
          />
        </div>
      )}

      {/* Saffron title/date panel — mirrors dcica.org's events design. */}
      <div className="bg-accent px-5 py-4 text-accent-fg">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Next up · {TYPE_LABEL[e.type] ?? "Event"}
          </span>
          {e.status === "ACTIVE" && (
            <span className="rounded-full bg-accent2 px-2 py-0.5 text-xs font-semibold text-accent2-fg">
              Happening now
            </span>
          )}
        </div>
        <h2 className="mt-1 text-xl font-bold leading-tight sm:text-2xl">
          {e.name}
        </h2>
        <p className="mt-0.5 text-sm font-medium">
          {formatWhen(e.startsAt, e.endsAt)}
        </p>
      </div>

      <div className="space-y-2 p-5">
        {primary && (
          <Link
            href={primary.href}
            className="flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-brand-fg"
          >
            {primary.label}
          </Link>
        )}
        {secondary.length > 0 && (
          <div
            className={
              secondary.length > 1 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"
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
    </section>
  );
}

function EventCard({
  event: e,
  kinds,
}: {
  event: EventRow;
  kinds?: EventOfferingKinds;
}) {
  const actions = eventActions(e, kinds);
  const [primary, ...secondary] = actions;

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      {e.imageUrl && (
        <div className="relative aspect-[3/2] bg-gray-100">
          <Image
            src={e.imageUrl}
            alt={e.name}
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      )}

      <div className="bg-accent px-4 py-3 text-accent-fg">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {TYPE_LABEL[e.type] ?? "Event"}
          </span>
          {e.status === "ACTIVE" && (
            <span className="rounded-full bg-accent2 px-2 py-0.5 text-xs font-semibold text-accent2-fg">
              Happening now
            </span>
          )}
        </div>
        <h3 className="mt-1 text-lg font-bold leading-tight">{e.name}</h3>
        <p className="mt-0.5 text-sm font-medium">
          {formatWhen(e.startsAt, e.endsAt)}
        </p>
      </div>

      <div className="mt-auto space-y-2 p-4">
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
              secondary.length > 1 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"
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
}
