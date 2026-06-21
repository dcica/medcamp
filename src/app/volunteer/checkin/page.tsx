import { requireRole } from "@/server/session";
import { PageHelp } from "@/app/_components/PageHelp";
import { VolunteerCheckinStation } from "./VolunteerCheckinStation";

export const dynamic = "force-dynamic";

/**
 * Volunteer day-of sign in/out station (Module 9 §5). Staffed by the volunteer
 * coordinator or a check-in volunteer; coordinator is superuser via requireRole.
 */
export default async function VolunteerCheckinPage() {
  await requireRole(
    "VOLUNTEER_COORDINATOR",
    "COMMITTEE_ADMIN",
    "STATION_VOLUNTEER",
  );

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="volunteer-checkin"
        title="Volunteer sign in / out"
        subtitle="Scan a volunteer's QR or enter their VOL-… code."
        items={[
          {
            label: "Sign in",
            body: "Scan on arrival to start their hours. Their role and instructions show on screen.",
          },
          {
            label: "Sign out",
            body: "Scan again at end of shift — hours are computed automatically from sign-in to sign-out.",
          },
          {
            label: "No camera?",
            body: "Type the VOL-… code printed under the QR on their confirmation.",
          },
        ]}
      />
      <VolunteerCheckinStation />
    </main>
  );
}
