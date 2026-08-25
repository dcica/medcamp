import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { instantToVenueInput, VENUE_TIME_ZONE } from "@/lib/eventTime";
import { STATUS_STYLE } from "@/lib/eventLifecycle";
import { PageHelp } from "@/app/_components/PageHelp";
import { BANNER_MAX_BYTES, uploadsEnabled } from "@/lib/storage";
import { BannerUpload } from "./BannerUpload";
import { CampControls } from "./CampControls";
import { EditEventForm } from "./EditEventForm";
import { EventFlags } from "./EventFlags";
import { PublicDoors } from "./PublicDoors";

export const dynamic = "force-dynamic";

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();

  const camp = org
    ? await db.event.findFirst({
        where: { id, orgId: org.id },
        include: {
          _count: {
            select: {
              caps: true,
              stations: true,
              // PAID ONLY. Attendee rows are minted at CART creation on a
              // PENDING order (src/server/registration.ts) and nothing reaps
              // the abandoned ones, so the unfiltered count included carts
              // nobody paid for — and, on a quantity-mode event, one row per
              // admitted head rather than per purchase. `campId` is assigned
              // inside confirmOrderPaid's transaction and nowhere else, which
              // makes it the one durable marker that money changed hands. Same
              // filter /dashboard uses, so the two screens can no longer
              // disagree about the word "registered".
              attendees: { where: { campId: { not: null } } },
            },
          },
        },
        // THE ONE PLACE `internalNotes` IS READ BACK. It is omitted from every
        // event query by default (see src/lib/db.ts) because the event row
        // outlives the purge, so a screen that wants it has to say so. This is
        // the edit form's own load — it needs the current value to put in the
        // box — and the page is behind requireAdmin.
        omit: { internalNotes: false },
      })
    : null;

  if (!camp) notFound();

  return (
    <div className="space-y-6">
      <Link href="/admin/camps" className="text-sm text-brand underline">
        ← Camps
      </Link>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{camp.name}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[camp.status]}`}
          >
            {camp.status}
          </span>
        </div>
        {/* Venue time. This is the header a coordinator checks a flyer against
            before opening the doors, so it must not shift with the server. */}
        <p className="mt-1 text-sm text-gray-500">
          {camp.code} ·{" "}
          {camp.startsAt.toLocaleString(undefined, {
            timeZone: VENUE_TIME_ZONE,
          })}{" "}
          →{" "}
          {camp.endsAt.toLocaleString(undefined, {
            timeZone: VENUE_TIME_ZONE,
          })}
        </p>
        {camp.location && (
          <p className="mt-1 text-sm text-gray-500">{camp.location}</p>
        )}
        {/*
          THE COUNTS ARE DOORS, NOT DECORATION. This line was three numbers in
          12px grey with nowhere to go: a coordinator who read "6 registered"
          and wanted to know WHO had no next tap on the screen. Each count now
          opens the screen that owns it, sized to the 48px tap minimum the
          platform mandates — as bare inline links these would be 14px targets.

          STATIONS ARE OMITTED AT ZERO rather than printed as "0 stations". A
          garba night has no patient routing and never will, which is the same
          ruling getEventReadiness already makes (src/server/events.ts: the
          stations row is CAMP-only). "0 stations" on a dance class reads as an
          unfinished setup step and is not one.
        */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          {[
            {
              href: `/admin/camps/${camp.id}/services`,
              label: `${camp._count.caps} services`,
            },
            ...(camp._count.stations > 0
              ? [
                  {
                    href: `/admin/camps/${camp.id}/stations`,
                    label: `${camp._count.stations} stations`,
                  },
                ]
              : []),
            {
              href: `/admin/camps/${camp.id}/registrations`,
              label: `${camp._count.attendees} registered`,
            },
          ].map((c, i) => (
            <span key={c.href} className="flex items-center gap-x-2">
              {i > 0 && <span className="text-gray-300">·</span>}
              <Link
                href={c.href}
                className="inline-flex min-h-tap items-center text-brand underline"
              >
                {c.label}
              </Link>
            </span>
          ))}
          {camp.walkInOpensAt && (
            <span className="flex items-center gap-x-2 text-gray-500">
              <span className="text-gray-300">·</span>walk-in OPEN
            </span>
          )}
        </div>
      </div>

      {/* The dates and the location are converted to venue wall clock *here*, on
          the server, so the input shows the same clock the header above and the
          public card show. */}
      <EditEventForm
        id={camp.id}
        initial={{
          name: camp.name,
          startsAt: instantToVenueInput(camp.startsAt),
          endsAt: instantToVenueInput(camp.endsAt),
          location: camp.location ?? "",
          // Null renders as an empty field, which is exactly what null means
          // here: no stated limit. Do not substitute a 0.
          venueCapacity: camp.venueCapacity?.toString() ?? "",
          internalNotes: camp.internalNotes ?? "",
        }}
      />

      <PageHelp
        id="admin-camp-detail"
        items={[
          {
            label: "Services & caps",
            body: "Set the service menu and the per-camp capacity limit for each service.",
          },
          {
            label: "Stations",
            body: "Define the stations and the order patients route through them (the Care Spine).",
          },
          {
            label: "Lifecycle",
            body: "Move the camp through DRAFT → OPEN → ACTIVE → CLOSED, and toggle walk-in registration on camp day.",
          },
          {
            label: "Purging",
            body: "After CLOSED, purging removes camp-scoped patient records. No clinical data (PHI) is ever stored to begin with.",
          },
        ]}
      />

      {/* Config sub-screens */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/admin/camps/${camp.id}/services`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Services &amp; caps →
        </Link>
        <Link
          href={`/admin/camps/${camp.id}/stations`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Stations →
        </Link>
        <Link
          href={`/admin/camps/${camp.id}/volunteers`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Volunteer roles →
        </Link>
      </div>

      {/* Which public doors this event opens. Above "Registration & policy"
          on purpose: whether the public can reach the form at all is the
          question that comes before how the form behaves. */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Public doors
        </h3>
        <PublicDoors
          id={camp.id}
          initial={{
            offersRegistration: camp.offersRegistration,
            offersVolunteers: camp.offersVolunteers,
            offersVendors: camp.offersVendors,
          }}
        />
      </div>

      {/* Registration & policy flags */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Registration &amp; policy
        </h3>
        <EventFlags
          id={camp.id}
          initial={{
            collectsAttendeeDetails: camp.collectsAttendeeDetails,
            acceptsDonations: camp.acceptsDonations,
            honorsMembership: camp.honorsMembership,
            allowsRefunds: camp.allowsRefunds,
          }}
        />
      </div>

      {/* Banner */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Banner
        </h3>
        <BannerUpload
          eventId={camp.id}
          initialUrl={camp.imageUrl}
          maxBytes={BANNER_MAX_BYTES}
          uploadsAvailable={uploadsEnabled()}
        />
      </div>

      {/* Lifecycle */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Lifecycle
        </h3>
        <CampControls
          id={camp.id}
          status={camp.status}
          endsAt={camp.endsAt}
          walkInOpen={Boolean(camp.walkInOpensAt)}
        />
      </div>
    </div>
  );
}
