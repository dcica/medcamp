import Link from "next/link";
import { db } from "@/lib/db";
import { PageHelp } from "@/app/_components/PageHelp";

export const dynamic = "force-dynamic";

// Where volunteer enquiries go. TODO: replace with the Volunteer module's real
// signup form (Volunteer/VolunteerRole/VolunteerSignup already exist in the
// schema) — this interest capture is the lightweight stand-in until then.
const CONTACT_EMAIL = "sachin@buzzclan.com";

/**
 * Volunteer interest page. The full Volunteer module (per-event roles, capacity
 * caps, QR sign in/out, certificates) is on the roadmap; for now this captures
 * intent and routes it to a coordinator by email.
 */
export default async function VolunteerPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event: eventId } = await searchParams;
  const event = eventId
    ? await db.event.findUnique({
        where: { id: eventId },
        select: { name: true },
      })
    : null;

  const subject = encodeURIComponent(
    event
      ? `Volunteer signup — ${event.name}`
      : "Volunteer signup — dcica events",
  );
  const body = encodeURIComponent(
    [
      "Hi dcica team,",
      "",
      "I'd like to volunteer at an upcoming event.",
      event ? `Event: ${event.name}` : "",
      "",
      "Name:",
      "Phone:",
      "Roles I'm interested in (e.g. registration, vitals, runner):",
      "Availability:",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="volunteer"
        title="Volunteer with us"
        subtitle={
          event ? `Help run ${event.name}.` : "Help run a dcica event."
        }
        items={[
          {
            label: "Who this is for",
            body: "Anyone who wants to help on the day — registration, vitals, crowd flow, setup, and more. No medical training needed for most roles.",
          },
          {
            label: "What happens next",
            body: "Email us your details and a coordinator confirms a role and shift. Day-of you'll sign in and out with a QR code so your hours are tracked.",
          },
        ]}
      />

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
        <p className="font-semibold text-gray-800">Tell us how you can help</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-gray-600">
          <li>Your name and phone number</li>
          <li>Roles you&apos;re interested in</li>
          <li>Your availability</li>
        </ul>

        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
          className="mt-5 flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
        >
          Email us to volunteer
        </a>
        <p className="mt-3 text-center text-xs text-gray-500">
          or write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>

      <p className="mt-6 text-center text-sm">
        <Link href="/events" className="text-brand underline">
          ← Back to events
        </Link>
      </p>
    </main>
  );
}
