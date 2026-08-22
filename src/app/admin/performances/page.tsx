import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { listEntries, offeringKindsByEvent } from "@/server/performance";
import { PageHelp } from "@/app/_components/PageHelp";
import { EntryRoster } from "./EntryRoster";

export const dynamic = "force-dynamic";

/**
 * Coordinator roster of competition / showcase entries.
 *
 * This is the screen the entry flow was missing: groups were paying and their
 * details were landing in the database with nothing in the back office to show
 * them. Ordered so the work comes first — entries without a prepared track at
 * the top — because that ordering IS the job until a running order exists.
 */
export default async function PerformancesPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  await requireAdmin();
  const { event: eventId } = await searchParams;
  const org = await getActiveOrg();

  // Only events that actually sell an entry fee can have entries. Listing every
  // event here would offer a coordinator a dozen pickers that resolve to empty.
  const candidates = org
    ? await db.event.findMany({
        where: {
          orgId: org.id,
          caps: {
            some: { serviceType: { active: true, admits: false, fulfillable: false } },
          },
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, name: true, code: true, startsAt: true, endsAt: true },
      })
    : [];

  // Default to the soonest event that has not finished — the one someone is
  // actually preparing for. Ordering `desc` and taking [0] put the furthest
  // FUTURE event first, so this page opened on a 2027 fixture with zero groups
  // while the event holding the real entries sat last in the picker. Falls back
  // to the most recent past event when everything has finished, because a
  // roster is still wanted the morning after a show.
  const now = new Date();
  const defaultEvent =
    candidates.find((c) => c.endsAt >= now) ??
    candidates[candidates.length - 1] ??
    null;
  const selected = candidates.find((c) => c.id === eventId) ?? defaultEvent;

  const entries = selected ? await listEntries(selected.id) : [];
  const kinds = selected
    ? (await offeringKindsByEvent([selected.id])).get(selected.id)
    : undefined;

  const awaitingMusic = entries.filter((e) => e.songReadyAt === null).length;
  const dancers = entries.reduce((n, e) => n + e.participantCount, 0);

  return (
    <div className="space-y-6">
      <PageHelp
        id="admin-performances"
        items={[
          {
            label: "Who's here",
            body: "Every group whose entry fee has cleared. Unpaid and abandoned checkouts never appear — payment is what confirms an entry.",
          },
          {
            label: "Music first",
            body: "Groups without a confirmed track sort to the top. Mark 'Track ready' once you have a playable, prepared cut in hand — not just when a file arrives.",
          },
          {
            label: "Needs contact",
            body: "A group that chose to send their music another way shows as Offline. Those need a human to chase.",
          },
        ]}
      />

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          No event is set up with a competition or showcase entry fee. Add a
          service that is neither admission nor merchandise under{" "}
          <Link href="/admin/camps" className="text-brand underline">
            Camps &amp; events
          </Link>
          .
        </p>
      ) : (
        <>
          {candidates.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/performances?event=${c.id}`}
                  className={`flex min-h-tap items-center rounded-lg border px-3 text-sm font-medium ${
                    c.id === selected?.id
                      ? "border-brand bg-brand text-brand-fg"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Groups" value={entries.length} />
            <Stat label="Dancers" value={dancers} />
            <Stat label="Music outstanding" value={awaitingMusic} />
          </div>

          {selected && (
            <p className="text-xs text-gray-500">
              {selected.name} · {selected.code}
              {kinds?.hasOther
                ? " · this event also sells admission, which is not shown here"
                : ""}
            </p>
          )}

          <EntryRoster entries={entries} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold text-brand">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
