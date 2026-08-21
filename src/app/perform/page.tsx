import Link from "next/link";
import { db } from "@/lib/db";
import { resolvePrice } from "@/lib/pricing";
import { isRegistrationOpen } from "@/server/registration";
import { uploadsEnabled, SONG_MAX_BYTES } from "@/lib/storage";
import { PageHelp } from "@/app/_components/PageHelp";
import { PerformanceEntryForm } from "./PerformanceEntryForm";

export const dynamic = "force-dynamic";

/**
 * Public competition / showcase entry (Rhythms of Navratri, Diwali Dhamaka).
 *
 * Sibling of /register rather than a mode of it: an entry is one GROUP buying one
 * per-group fee that admits nobody, and it collects group details /register has
 * no notion of. The two share createRegistration underneath, so there is still
 * one money path.
 *
 * Honours ?event=<id> from the events listing; with no id it falls back to the
 * soonest-ending open event that actually offers an entry fee.
 */
export default async function PerformPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event: eventId } = await searchParams;

  // ONE clock for the whole render — the candidate query, the open/closed
  // predicate and the displayed price all answer to this instant. Same reasoning
  // as /register: a single request must not hold two opinions about whether the
  // event is sellable.
  const now = new Date();

  // A fee-kind offering is what makes an event enterable: neither admission nor
  // merch. Without this filter the fallback could land on a dandiya night that
  // sells floor tickets and has no competition at all.
  const feeOffering = {
    serviceType: { active: true, admits: false, fulfillable: false },
  } as const;

  // Fetch, THEN apply isRegistrationOpen — the same predicate the submit action
  // uses via createRegistration. Filtering status in the query is what lets a
  // page render a checkout the action then refuses. The ?event= branch is
  // deliberately unfiltered on status so a direct link reaches the predicate and
  // is judged by it.
  const candidate = eventId
    ? await db.event.findFirst({
        where: { id: eventId, caps: { some: feeOffering } },
      })
    : await db.event.findFirst({
        where: {
          caps: { some: feeOffering },
          OR: [
            { status: "OPEN", endsAt: { gte: now } },
            { status: "ACTIVE", walkInOpensAt: { not: null } },
          ],
        },
        orderBy: { endsAt: "asc" },
      });

  const event =
    candidate && isRegistrationOpen(candidate, now) ? candidate : null;

  if (!event) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Performance entry</h1>
        <p className="mt-2 text-sm text-gray-600">
          No event is taking performance entries right now.
        </p>
        <p className="mt-6">
          <Link href="/events" className="text-sm text-brand underline">
            ← Back to events
          </Link>
        </p>
      </main>
    );
  }

  const offerings = await db.serviceCap.findMany({
    where: { eventId: event.id, ...feeOffering },
    include: { serviceType: true },
    orderBy: { serviceType: { name: "asc" } },
  });

  // Price resolves through the SAME resolvePrice the authoritative total uses
  // (online channel, this render's `now`). A display feed, not a second source
  // of truth — if it diverged, the entrant would read one number and be charged
  // another.
  const entries = offerings.map((o) => {
    const resolved = resolvePrice(o, "online", now);
    return {
      key: o.serviceType.key,
      name: o.serviceType.name,
      priceCents: resolved.amountCents,
      /** True when an early-bird price is what's being charged right now. */
      isEarlyBird: o.earlyBirdPriceCents !== null && resolved.amountCents === o.earlyBirdPriceCents,
      earlyBirdUntil: o.earlyBirdUntil?.toISOString() ?? null,
      minParticipants: o.minParticipants,
      maxParticipants: o.maxParticipants,
      minDurationSeconds: o.minDurationSeconds,
      maxDurationSeconds: o.maxDurationSeconds,
    };
  });

  const maxMb = Math.round(SONG_MAX_BYTES / (1024 * 1024));
  const canUpload = uploadsEnabled();

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <PageHelp
        id="perform"
        title="Enter a performance"
        subtitle={event.name}
        items={[
          {
            label: "One group per entry",
            body: "Each entry is one group with one song. Entering two groups? Fill this in twice — the details differ each time.",
          },
          {
            label: "Your slot is confirmed when you pay",
            body: "The fee is per group, not per dancer. Nothing is held until payment goes through.",
          },
          {
            label: "Your music",
            body: canUpload
              ? `After paying you get a link to upload your MP3 (up to ${maxMb} MB). If that won't work, you can ask us to collect it another way.`
              : "After paying you'll get a link to your entry, and an organizer will contact you about your track.",
          },
          {
            label: "No refunds",
            body: "Entry fees aren't refundable, including no-shows.",
          },
        ]}
      />

      <PerformanceEntryForm
        eventId={event.id}
        eventName={event.name}
        entries={entries}
        uploadsAvailable={canUpload}
        maxUploadMb={maxMb}
      />

      <p className="mt-6 text-center text-sm">
        <Link href="/events" className="text-brand underline">
          ← Back to events
        </Link>
      </p>
    </main>
  );
}
