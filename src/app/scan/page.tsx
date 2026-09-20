import Link from "next/link";
import { requireRole } from "@/server/session";
import { getActiveOrg } from "@/lib/tenant";
import { getEventHeadcount, getGateCatalog } from "@/server/gate";
import { getScanStationEvent, SCAN_STATION_SETUP_HOURS } from "@/server/events";
import { PageHelp } from "@/app/_components/PageHelp";
import { GateMode } from "./GateMode";
import { CampMode } from "./CampMode";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Never a search result. See PRIVATE_PAGE_METADATA for which of the two
// reasons applies to this page.
export const metadata = PRIVATE_PAGE_METADATA;

/**
 * ONE scan station. "Gate and check in are same. Club them."
 *
 * They were two routes duplicating an entire front half — the same scanner, the
 * same manual-entry box, the same "what just happened" feedback — while their
 * back halves were never duplicated at all. This merges the front and keeps the
 * back halves apart, because the split follows the GUARD boundary, not a
 * cosmetic one:
 *
 *   GENERAL — money, headcount, wristband. Four roles, POS_TILL among them.
 *             Many people, seconds each. Stays inline, camera live.
 *   CAMP    — waiver, badge, station routing. Three roles, and the camp actions
 *             keep their own CHECKIN_ROLES guard. One person, several steps.
 *             Deep-links to /checkin/[campId].
 *
 * A union guard over both would hand a cash handler a medical waiver form and
 * then 403 them mid-flow; an intersection guard would lock POS_TILL out of the
 * door they were rostered for. With the split, a POS till holder who scans a
 * camp code gets a refusal they can read.
 *
 * The four roles below MUST mirror GATE_ROLES in src/app/gate/actions.ts.
 * They are spelled out rather than imported because a "use server" module may
 * only export async functions, so that array cannot be shared.
 */
export default async function ScanPage() {
  await requireRole(
    "REGISTRATION_TILL",
    "REGISTRATION_NO_TILL",
    "STATION_VOLUNTEER",
    "POS_TILL",
  );

  const org = await getActiveOrg();
  const event = org ? await getScanStationEvent(org.id) : null;

  // NULL IS A CORRECT ANSWER — see the doctrine on getCurrentEvent. Most of the
  // year nothing is running, and the station says so and points at the event
  // list rather than reaching for the nearest plausible row.
  if (!event) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">Nothing to scan right now</h1>
        <p className="mt-2 text-sm text-gray-600">
          The station opens for an <span className="font-medium">ACTIVE</span>{" "}
          event that is running, or starting within{" "}
          {SCAN_STATION_SETUP_HOURS} hours — so you can set up before doors.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          If tonight&rsquo;s event is further out than that, or is not marked
          active yet, open it in event admin.
        </p>
        <Link
          href="/admin/camps"
          className="mt-6 inline-block min-h-tap text-sm text-brand underline"
        >
          → Event admin
        </Link>
      </main>
    );
  }

  if (event.type === "CAMP") {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-6">
        <PageHelp
          id="scan-camp"
          title="Check in"
          subtitle={event.name}
          items={[
            {
              label: "Scan the badge",
              body: "Point the camera at the patient's QR badge. You'll land on their check-in screen.",
            },
            {
              label: "No badge?",
              body: `Type just the code after ${event.code}- — the prefix is already filled in for you.`,
            },
            {
              label: "Waiver first",
              body: "Check-in needs a confirmed payment and a signed waiver. Both are on the next screen.",
            },
          ]}
        />
        <CampMode eventCode={event.code} />
      </main>
    );
  }

  const [headcount, catalog] = await Promise.all([
    getEventHeadcount(event.id),
    getGateCatalog(event.id),
  ]);

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <PageHelp
        id="scan-gate"
        title="Gate"
        subtitle={event.name}
        items={[
          {
            label: "Scan to admit",
            body: "Keep the camera up and scan ticket QRs one after another. Each scan shows the guest and what they're owed or owe.",
          },
          {
            label: "Pick up",
            body: "Pre-bought merch (e.g. dandiya sticks) shows under the guest — tap Hand over once you give it to them.",
          },
          {
            label: "Pay at the gate",
            body: "Unpaid ticket or buying merch on the spot? Take cash and the guest is admitted. (Till holders only.)",
          },
          {
            label: "Member comp",
            body: "A membership covers up to 4. Check their card, set the party size, and admit — no charge.",
          },
        ]}
      />

      <GateMode
        eventId={event.id}
        eventName={event.name}
        eventCode={event.code}
        initialHeadcount={headcount}
        catalog={catalog}
      />
    </main>
  );
}
