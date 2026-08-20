import Link from "next/link";
import { db } from "@/lib/db";
import { PageHelp } from "@/app/_components/PageHelp";
import { CONTACT_EMAIL } from "@/lib/contact";

export const dynamic = "force-dynamic";

// Where vendor enquiries go: the org's one public address, shared with the
// footer and the empty calendar state. The per-tenant-settings note lives on the
// constant itself now, so it cannot rot in one copy and not the others.

/**
 * Vendor interest page. Lightweight by design — the full vendor module (booths,
 * payments via Zelle/check) isn't built yet, so this captures intent and routes
 * it to the organizers by email rather than shipping a half-finished form.
 */
export default async function VendorsPage({
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
    event ? `Vendor interest — ${event.name}` : "Vendor interest — DCICA events",
  );
  const body = encodeURIComponent(
    [
      "Hi DCICA team,",
      "",
      "We'd like to be a vendor/sponsor at an upcoming event.",
      event ? `Event: ${event.name}` : "",
      "",
      "Organization / business name:",
      "What we offer:",
      "Booth needs (table, power, space):",
      "Contact name & phone:",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="vendors"
        title="Become a vendor"
        subtitle={
          event
            ? `Sell or sponsor at ${event.name}.`
            : "Sell or sponsor at a DCICA event."
        }
        items={[
          {
            label: "Who this is for",
            body: "Businesses and sponsors who want a booth or to support an event. Patients and volunteers don't use this page.",
          },
          {
            label: "What happens next",
            body: "Email us the details and an organizer follows up with booth options and pricing. Vendor payments are handled by Zelle or check, not online.",
          },
        ]}
      />

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
        <p className="font-semibold text-gray-800">Tell us about your booth</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-gray-600">
          <li>Organization or business name</li>
          <li>What you sell or how you&apos;d like to sponsor</li>
          <li>Booth needs — table, power, space</li>
          <li>A contact name and phone number</li>
        </ul>

        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
          className="mt-5 flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
        >
          Email us your details
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
