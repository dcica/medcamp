import Link from "next/link";
import { getVolunteerConfirmation } from "@/server/volunteers";
import { PrintButton } from "@/app/badge/[campId]/PrintButton";

export const dynamic = "force-dynamic";

/**
 * Volunteer certificate of appreciation (Module 9 §7). Public — reachable from the
 * thank-you email link. Built to satisfy school community-service-hour
 * requirements: name, event + date, role, verified hours, org + 501(c)(3) status,
 * and a verification contact. Prints clean via browser → "Save as PDF" (same
 * print-CSS approach as the patient badge; no extra PDF dependency).
 */
export default async function VolunteerCertificatePage({
  params,
}: {
  params: Promise<{ signupId: string }>;
}) {
  const { signupId } = await params;
  const c = await getVolunteerConfirmation(signupId);

  if (!c) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Certificate not found</h1>
        <Link href="/" className="mt-4 inline-block text-sm text-brand underline">
          ← Home
        </Link>
      </main>
    );
  }

  const eligible = c.status === "CHECKED_OUT";
  const day = c.startsAt.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (!eligible) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Certificate not ready yet</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your certificate is generated after you sign out on the day of the event,
          once your hours are recorded.
        </p>
        <Link
          href={`/volunteer/confirm/${c.signupId}`}
          className="mt-4 inline-block text-sm text-brand underline"
        >
          ← Back to your confirmation
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-md px-4 py-6">
      <div className="badge-print rounded-xl border-4 border-double border-brand/40 bg-white p-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">
          Certificate of Appreciation
        </p>
        <p className="mt-8 text-sm text-gray-600">This certifies that</p>
        <h1 className="mt-2 text-3xl font-bold text-brand">{c.volunteerName}</h1>
        <p className="mt-6 text-sm text-gray-700">
          volunteered as <span className="font-semibold">{c.roleName}</span> at
        </p>
        <p className="mt-1 text-lg font-semibold text-gray-900">{c.eventName}</p>
        <p className="text-sm text-gray-600">{day}</p>

        <div className="mx-auto mt-6 inline-block rounded-lg bg-brand/5 px-6 py-3">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Hours served
          </span>
          <p className="text-2xl font-bold text-brand">
            {c.hoursServed != null ? c.hoursServed.toFixed(1) : "—"}
          </p>
        </div>

        <div className="mt-10 flex items-end justify-between text-left text-xs text-gray-500">
          <div>
            <p className="border-t border-gray-400 pt-1">Authorized signature</p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-gray-700">{c.orgName}</p>
            <p>501(c)(3) non-profit</p>
            <p>Verify: admin@dcica.org</p>
          </div>
        </div>
      </div>

      <div className="no-print mt-4 space-y-2">
        <PrintButton label="Print / save as PDF" />
        <p className="text-center text-xs text-gray-500">
          Use your browser&apos;s print dialog and choose &quot;Save as PDF&quot; to
          download. App chrome is hidden automatically.
        </p>
      </div>
    </main>
  );
}
