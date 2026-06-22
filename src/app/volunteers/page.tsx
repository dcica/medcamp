import Link from "next/link";
import { requireVolunteerCoordinator } from "@/server/admin";
import { getVolunteerRoster, listVolunteerEvents } from "@/server/volunteers";
import { AutoRefresh } from "@/app/dashboard/AutoRefresh";
import { PageHelp } from "@/app/_components/PageHelp";
import { RosterView } from "./RosterView";

export const dynamic = "force-dynamic";

/**
 * Volunteer coordinator dashboard (Module 9 §5). Live roster, per-role staffing
 * vs. target, source attribution, hours adjustment, reminders + certificates.
 * The org can have several events taking volunteers at once (a camp + community
 * events); the ?event= picker selects which one this dashboard manages.
 */
export default async function VolunteersDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  await requireVolunteerCoordinator();
  const { event: eventId } = await searchParams;
  const [roster, events] = await Promise.all([
    getVolunteerRoster(eventId),
    listVolunteerEvents(),
  ]);

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

      {events.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {events.map((e) => {
            const selected = e.id === roster.eventId;
            return (
              <Link
                key={e.id}
                href={`/volunteers?event=${e.id}`}
                aria-current={selected ? "page" : undefined}
                className={`min-h-tap inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium ${
                  selected
                    ? "border-brand bg-brand text-brand-fg"
                    : "border-gray-300 text-gray-700"
                }`}
              >
                {e.name}
                {e.status === "ACTIVE" && (
                  <span className="ml-1.5 text-xs opacity-80">· live</span>
                )}
              </Link>
            );
          })}
        </div>
      )}

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
        <RosterView roster={roster} eventId={roster.eventId} />
      </div>
    </main>
  );
}
