import Link from "next/link";
import { getVolunteerSignupView } from "@/server/volunteers";
import { normalizeSourceTag } from "@/lib/volunteerRoles";
import { PageHelp } from "@/app/_components/PageHelp";
import { VolunteerSignupForm } from "./VolunteerSignupForm";

export const dynamic = "force-dynamic";

/**
 * Public volunteer signup (Module 9). No login. The tagged ?src= link records the
 * outreach channel (school | past | social | org) for attribution.
 */
export default async function VolunteerSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const { src } = await searchParams;
  const view = await getVolunteerSignupView();

  if (!view) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">No event is taking volunteers yet</h1>
        <p className="mt-2 text-sm text-gray-600">
          Check back soon — volunteer signups open before each event.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-brand underline">
          ← Home
        </Link>
      </main>
    );
  }

  const day = view.startsAt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="volunteer-signup"
        title="Volunteer sign-up"
        subtitle={`${view.eventName} · ${day}`}
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
      <VolunteerSignupForm
        roles={view.roles}
        sourceTag={normalizeSourceTag(src)}
      />
    </main>
  );
}
