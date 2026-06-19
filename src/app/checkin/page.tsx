import { requireRole } from "@/server/session";
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
      <h1 className="text-2xl font-bold text-brand">Check-in</h1>
      <p className="mt-1 text-sm text-gray-600">
        Scan a patient&apos;s QR badge or enter their camp ID.
      </p>
      <CheckinStation />
    </main>
  );
}
