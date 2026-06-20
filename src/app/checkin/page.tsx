import { requireRole } from "@/server/session";
import { PageHelp } from "@/app/_components/PageHelp";
import { CheckinStation } from "./CheckinStation";

export const dynamic = "force-dynamic";

/**
 * Check-in station (Module 2). Staffed by the registration desk or a check-in
 * volunteer. Coordinator is superuser via requireRole.
 */
export default async function CheckinPage() {
  await requireRole(
    "REGISTRATION_TILL",
    "REGISTRATION_NO_TILL",
    "STATION_VOLUNTEER",
  );

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="checkin"
        title="Check-in"
        subtitle="Scan a patient's QR badge or enter their camp ID."
        items={[
          {
            label: "Scan QR",
            body: "Point the device camera at the QR on the badge or confirmation email to look the patient up instantly.",
          },
          {
            label: "Camp ID",
            body: "No camera? Type the MC-… code printed under the QR instead.",
          },
          {
            label: "What happens next",
            body: "The patient's screen shows payment and waiver status. Check-in only unlocks once both are cleared.",
          },
        ]}
      />
      <CheckinStation />
    </main>
  );
}
