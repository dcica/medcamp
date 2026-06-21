import Link from "next/link";
import { requireVolunteerCoordinator } from "@/server/admin";
import { getVolunteerRoster } from "@/server/volunteers";
import { AutoRefresh } from "@/app/dashboard/AutoRefresh";
import { PageHelp } from "@/app/_components/PageHelp";
import { RosterView } from "./RosterView";

export const dynamic = "force-dynamic";

/**
 * Volunteer coordinator dashboard (Module 9 §5). Live roster, per-role staffing
 * vs. target, source attribution, hours adjustment, reminders + certificates.
 */
export default async function VolunteersDashboardPage() {
  await requireVolunteerCoordinator();
  const roster = await getVolunteerRoster();

  if (!roster) {
    return (
      <main className="mx-auto max-w-screen-md px-4 py-10">
        <h1 className="text-xl font-bold">No active event</h1>
        <p className="mt-2 text-sm text-gray-600">
          Open or activate an event to manage its volunteers.
        </p>
        <Link
          href="/admin/camps"
          className="mt-4 inline-block text-sm text-brand underline"
        >
          → Camps
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-md px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">Volunteers</h1>
          <p className="mt-1 text-sm text-gray-600">{roster.eventName}</p>
        </div>
        <AutoRefresh />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link href="/volunteers/counselors" className="text-brand underline">
          Counselors →
        </Link>
        <Link href="/volunteer/checkin" className="text-brand underline">
          Sign in / out station →
        </Link>
      </div>

      <div className="mt-3">
        <PageHelp
          id="volunteers-dashboard"
          items={[
            {
              label: "Understaffed roles",
              body: "Roles below target are highlighted — redeploy volunteers or push more outreach.",
            },
            {
              label: "Hours",
              body: "Auto-computed at sign-out. Tap a volunteer's hours to adjust for early-leave or late-stay.",
            },
            {
              label: "Certificates",
              body: "Issuing certificates stamps every checked-out volunteer and emails their thank-you + certificate link.",
            },
            {
              label: "Counselors",
              body: "The Counselors view rolls up hours per school advisor for recruitment outreach.",
            },
          ]}
        />
      </div>

      <div className="mt-4">
        <RosterView roster={roster} />
      </div>
    </main>
  );
}
