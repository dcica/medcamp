import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { eventRoster, offeringKindsByEvent } from "@/server/performance";
import { PageHelp } from "@/app/_components/PageHelp";
import { EntryRoster } from "./EntryRoster";
import { EventPicker } from "./EventPicker";
import { RosterSummaryPanel } from "./RosterSummaryPanel";

export const dynamic = "force-dynamic";

/**
 * Coordinator roster of competition / showcase entries.
 *
 * This is the screen the entry flow was missing: groups were paying and their
 * details were landing in the database with nothing in the back office to show
 * them. Ordered so the work comes first — entries without a prepared track at
 * the top — because that ordering IS the job until a running order exists.
 *
 * Every number shown here is computed in src/server/performance.ts from exactly
 * the rows rendered below it, and every music count on the page (summary tile,
 * detail split, filter chip, card badge) resolves through the one `musicState`
 * function. The page used to derive "music outstanding" here with a different
 * rule from the badges, and the two disagreed on screen.
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
            some: { serviceType: { active: true, kind: "FEE" } },
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

  const roster = selected ? await eventRoster(selected) : null;
  const kinds = selected
    ? (await offeringKindsByEvent([selected.id])).get(selected.id)
    : undefined;

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
            label: "The four music chips",
            body: "Each one is a different job. Offline needs a phone call. Not sent yet needs a reminder email. Received, unchecked needs someone to actually listen to the file. Confirmed is done.",
          },
          {
            label: "Copy and export follow the chip",
            body: "With a chip active, 'Copy emails' and 'Export CSV' cover only the groups on screen — that is the list you are chasing.",
          },
          {
            label: "Show estimate",
            body: "Declared lengths plus an assumed 60-second changeover between acts. Entries with no declared length add changeover but no runtime, so the estimate is short by however long they run.",
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
          <EventPicker events={candidates} selectedId={selected?.id ?? null} />

          {roster && <RosterSummaryPanel summary={roster.summary} />}

          {selected && (
            <p className="text-xs text-gray-500">
              {selected.name} · {selected.code}
              {kinds?.hasOther
                ? " · this event also sells admission, which is not counted in the entry capacity above"
                : ""}
            </p>
          )}

          {selected && roster && (
            <EntryRoster entries={roster.entries} eventId={selected.id} />
          )}
        </>
      )}
    </div>
  );
}
