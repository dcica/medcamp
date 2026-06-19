import QRCode from "qrcode";
import Link from "next/link";
import { requireRole } from "@/server/session";
import { getBadge } from "@/server/checkin";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * Printable patient badge (Module 2): QR (camp ID) + color-coded service dots +
 * station checklist. Print CSS hides app chrome so it lands clean on a label or
 * A4 sheet at the registration desk printer.
 */
export default async function BadgePage({
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
  const badge = await getBadge(decodeURIComponent(campId));

  if (!badge) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">No match</h1>
        <Link href="/checkin" className="mt-4 inline-block text-sm text-brand underline">
          ← Back to check-in
        </Link>
      </main>
    );
  }

  const qr = await QRCode.toDataURL(badge.campId, { margin: 1, width: 256 });

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <div className="badge-print rounded-xl border border-gray-300 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-bold">{badge.name}</span>
          <span className="font-mono text-sm text-gray-600">{badge.campId}</span>
        </div>
        <p className="text-xs text-gray-500">{badge.eventName}</p>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR ${badge.campId}`} className="mx-auto my-4 h-48 w-48" />

        {/* Color-coded service dots */}
        <div className="flex flex-wrap justify-center gap-2">
          {badge.services.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs"
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: s.colorHex }}
              />
              {s.name}
            </span>
          ))}
        </div>

        {/* Station checklist */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Checklist
          </p>
          <ul className="space-y-1.5">
            {badge.route.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-4 w-4 rounded border border-gray-400" />
                {r.name}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="no-print mt-4 space-y-2">
        <PrintButton />
        <Link
          href={`/checkin/${encodeURIComponent(badge.campId)}`}
          className="block text-center text-sm text-brand underline"
        >
          ← Back to attendee
        </Link>
      </div>
    </main>
  );
}
