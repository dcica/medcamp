import QRCode from "qrcode";
import Link from "next/link";
import { getVolunteerConfirmation } from "@/server/volunteers";
import { CancelButton } from "./CancelButton";

export const dynamic = "force-dynamic";

/**
 * Volunteer confirmation (Module 9 §2/§4). Public — no login. Shows the assigned
 * role, shift, instructions and a QR code for day-of sign in/out, plus a cancel
 * link. Same QR/badge infrastructure as patient check-in.
 */
export default async function VolunteerConfirmPage({
  params,
}: {
  params: Promise<{ signupId: string }>;
}) {
  const { signupId } = await params;
  const c = await getVolunteerConfirmation(signupId);

  if (!c) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Signup not found</h1>
        <Link
          href="/volunteer"
          className="mt-4 inline-block text-sm text-brand underline"
        >
          ← Back to sign-up
        </Link>
      </main>
    );
  }

  const cancelled = c.status === "CANCELLED";
  const waitlisted = c.status === "WAITLISTED";
  const qr = await QRCode.toDataURL(c.code, { margin: 1, width: 256 });

  const day = c.startsAt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const arrival = c.startsAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      {cancelled ? (
        <div className="rounded-xl border border-gray-300 bg-gray-50 p-5 text-center">
          <h1 className="text-lg font-bold text-gray-700">Spot released</h1>
          <p className="mt-1 text-sm text-gray-600">
            You&apos;ve cancelled your spot for {c.eventName}.
          </p>
          <Link
            href="/volunteer"
            className="mt-4 inline-block text-sm text-brand underline"
          >
            Sign up again
          </Link>
        </div>
      ) : (
        <>
          <div className="badge-print rounded-xl border border-gray-300 bg-white p-5">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {waitlisted ? "You're on the waitlist for" : "You're confirmed for"}
              </p>
              <h1 className="text-xl font-bold text-brand">{c.eventName}</h1>
              <p className="mt-1 text-sm text-gray-600">{day}</p>
            </div>

            {waitlisted ? (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                This role is full — we&apos;ll email you if a spot opens up.
              </p>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`QR ${c.code}`}
                  className="mx-auto my-4 h-48 w-48"
                />
                <p className="text-center font-mono text-sm text-gray-600">
                  {c.code}
                </p>
                <p className="mt-1 text-center text-xs text-gray-500">
                  Show this to sign in and out on the day.
                </p>
              </>
            )}

            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Role" value={c.roleName} />
              {c.shift && <Row label="Shift" value={c.shift} />}
              <Row label="Arrive by" value={arrival} />
              {c.instructions && <Row label="What to know" value={c.instructions} />}
            </dl>
          </div>

          <div className="mt-4 space-y-3">
            {!waitlisted && <CancelButton signupId={c.signupId} />}
            <Link
              href="/volunteer"
              className="no-print block text-center text-sm text-brand underline"
            >
              ← Sign up someone else
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  );
}
