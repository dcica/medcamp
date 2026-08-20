import Link from "next/link";
import { getVolunteerSignupView } from "@/server/volunteers";
import { normalizeSourceTag } from "@/lib/volunteerRoles";
import { VENUE_TIME_ZONE } from "@/lib/eventTime";
import { PageHelp } from "@/app/_components/PageHelp";
import { VolunteerSignupForm } from "./VolunteerSignupForm";
import { GeneralInterestForm } from "./GeneralInterestForm";

export const dynamic = "force-dynamic";

/**
 * Public volunteer signup (Module 9). No login. The tagged ?src= link records the
 * outreach channel (school | past | social | org) for attribution.
 *
 * Two ways in, and the general one is always offered. Event signups are the
 * primary path when an event is taking volunteers, but this page used to be a
 * dead end the rest of the time — "check back soon" to somebody who had already
 * come back. Between events is exactly when a willing volunteer turns up, so
 * registering interest with no event attached is offered whether or not an
 * event is open. See registerGeneralVolunteer(): it writes the same Volunteer
 * row an event signup would, deduped on email, so the two paths converge on one
 * person rather than two records.
 */
export default async function VolunteerSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; event?: string }>;
}) {
  const { src, event } = await searchParams;
  const view = await getVolunteerSignupView(event);

  if (!view) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Volunteer with DCICA</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          No event is taking signups at the moment — they open a few weeks before
          each one. Leave your details and a coordinator will contact you when
          the next event opens.
        </p>
        <div className="mt-5">
          <GeneralInterestForm sourceTag={normalizeSourceTag(src)} />
        </div>
        <Link href="/" className="mt-6 inline-block text-sm text-brand underline">
          ← Home
        </Link>
      </main>
    );
  }

  // Venue day. A signup page read on a phone in another zone must name the day
  // the shift actually falls on at the venue.
  const day = view.startsAt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: VENUE_TIME_ZONE,
  });

  const subtitleParts = [view.eventName, day];
  if (view.location) subtitleParts.push(view.location);

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="volunteer-signup"
        title="Volunteer sign-up"
        subtitle={subtitleParts.join(" · ")}
        items={[
          {
            label: "Service hours",
            body: "Earn verified community-service hours. Add your school counselor / advisor and we'll have your hours ready for them after the event.",
          },
          {
            label: "Age group",
            body: "Roles are matched to age for suitability and supervision — you'll only see tasks you're eligible for. Volunteers never do clinical work.",
          },
          {
            label: "Under 18",
            body: "A parent / guardian consent name is required before you can finish signing up.",
          },
          {
            label: "After you sign up",
            body: "You'll get a confirmation with a QR code to sign in fast on the day, and a reminder before the event.",
          },
        ]}
      />
      {view.externallyHosted && (
        <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-gray-700">
          <p className="font-semibold text-brand">
            Community booth{view.hostedByName ? ` · hosted by ${view.hostedByName}` : ""}
          </p>
          {view.description && <p className="mt-1">{view.description}</p>}
        </div>
      )}
      <VolunteerSignupForm
        roles={view.roles}
        sourceTag={normalizeSourceTag(src)}
      />

      {/* Kept below the event form, never beside it: someone who came to sign
          up for a specific day should not have to choose between two forms
          before reading either. This is the fallback for the person who cannot
          make that date but still wants to help. */}
      <section className="mt-10 border-t border-gray-200 pt-6">
        <h2 className="text-lg font-bold text-brand">
          Can&apos;t make this one?
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          Add yourself to the general volunteer list and a coordinator will
          reach out about future events.
        </p>
        <div className="mt-4">
          <GeneralInterestForm sourceTag={normalizeSourceTag(src)} />
        </div>
      </section>
    </main>
  );
}
