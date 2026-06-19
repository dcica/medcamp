import Link from "next/link";
import { requireRole } from "@/server/session";
import { getAttendeeForCheckin } from "@/server/checkin";
import { WaiverForm } from "./WaiverForm";
import { CheckinActions } from "./CheckinActions";

export const dynamic = "force-dynamic";

/**
 * Attendee check-in screen. Verifies payment, captures the waiver, and checks
 * the patient in. The check-in button is gated on paid + waiver (server-enforced
 * too). Once checked in, links to the printable badge.
 */
export default async function CheckinAttendeePage({
  params,
}: {
  params: Promise<{ campId: string }>;
}) {
  await requireRole(
    "REGISTRATION_TILL",
    "REGISTRATION_NO_TILL",
    "STATION_VOLUNTEER",
  );

  const { campId } = await params;
  const a = await getAttendeeForCheckin(decodeURIComponent(campId));

  if (!a) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">No match</h1>
        <p className="mt-2 text-sm text-gray-600">
          No attendee found for <span className="font-mono">{decodeURIComponent(campId)}</span>.
        </p>
        <Link href="/checkin" className="mt-6 inline-block text-sm text-brand underline">
          ← Back to check-in
        </Link>
      </main>
    );
  }

  const checkedIn = Boolean(a.checkedInAt);
  const ready = a.isPaid && a.waiverSigned && !checkedIn;

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <Link href="/checkin" className="text-sm text-brand underline">
        ← Check-in
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{a.name}</h1>
        <span className="font-mono text-sm text-gray-500">{a.campId}</span>
      </div>
      <p className="text-sm text-gray-500">{a.eventName}</p>

      {/* Payment guard */}
      {!a.isPaid && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Payment not confirmed. Send to the registration desk before check-in.
        </div>
      )}

      {/* Services */}
      <div className="mt-4 flex flex-wrap gap-2">
        {a.services.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.colorHex }}
            />
            {s.name}
          </span>
        ))}
      </div>

      {/* Waiver / status */}
      <div className="mt-6 space-y-4">
        {checkedIn ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
            <p className="font-semibold text-green-800">Checked in ✓</p>
            <p className="mt-1 text-xs text-green-700">
              {a.checkedInAt?.toLocaleTimeString()}
            </p>
            <Link
              href={`/badge/${encodeURIComponent(a.campId)}`}
              className="mt-3 inline-block min-h-tap rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg"
            >
              Print badge
            </Link>
          </div>
        ) : (
          <>
            {a.waiverSigned ? (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Waiver signed ✓
              </div>
            ) : (
              <WaiverForm campId={a.campId} />
            )}
            <CheckinActions campId={a.campId} ready={ready} />
          </>
        )}
      </div>
    </main>
  );
}
