import Link from "next/link";
import { requireRole } from "@/server/session";
import { getVolunteerByCode } from "@/server/volunteers";
import { CheckinActions } from "./CheckinActions";

export const dynamic = "force-dynamic";

/**
 * A single volunteer's day-of sign in/out screen, reached from the scanner.
 * Shows their role + instructions and the appropriate action for their state.
 */
export default async function VolunteerCheckinDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireRole(
    "VOLUNTEER_COORDINATOR",
    "COMMITTEE_ADMIN",
    "STATION_VOLUNTEER",
  );

  const { code } = await params;
  const v = await getVolunteerByCode(decodeURIComponent(code));

  if (!v) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">No match</h1>
        <p className="mt-2 text-sm text-gray-600">
          No volunteer found for that code in the active event.
        </p>
        <Link
          href="/volunteer/checkin"
          className="mt-4 inline-block text-sm text-brand underline"
        >
          ← Back to scanner
        </Link>
      </main>
    );
  }

  const checkedIn = Boolean(v.checkedInAt);
  const checkedOut = Boolean(v.checkedOutAt);

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <div className="rounded-xl border border-gray-300 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-bold">{v.volunteerName}</span>
          <span className="font-mono text-xs text-gray-500">{v.code}</span>
        </div>
        <p className="text-sm text-gray-600">{v.roleName}</p>

        {v.shift && (
          <p className="mt-2 text-sm">
            <span className="text-gray-500">Shift: </span>
            {v.shift}
          </p>
        )}
        {v.instructions && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            {v.instructions}
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Signed in" value={fmtTime(v.checkedInAt)} />
          <Stat label="Signed out" value={fmtTime(v.checkedOutAt)} />
          {v.hoursServed != null && (
            <Stat label="Hours" value={v.hoursServed.toFixed(1)} />
          )}
        </dl>
      </div>

      <div className="mt-4">
        <CheckinActions code={v.code} checkedIn={checkedIn} checkedOut={checkedOut} />
      </div>

      <Link
        href="/volunteer/checkin"
        className="mt-4 block text-center text-sm text-brand underline"
      >
        ← Scan another
      </Link>
    </main>
  );
}

function fmtTime(d: Date | null): string {
  return d
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
