import Link from "next/link";
import { requireRole } from "@/server/session";
import {
  getActiveGeneralEvent,
  getEventHeadcount,
  getGateCatalog,
} from "@/server/gate";
import { PageHelp } from "@/app/_components/PageHelp";
import { GateStation } from "./GateStation";

export const dynamic = "force-dynamic";

/**
 * Event gate (general / ticketed events, e.g. a dandia dance night). Shares the
 * scan→resolve primitive with medcamp check-in, but the actions are admission +
 * will-call merch pickup + on-the-spot POS, with continuous scanning. Medcamp
 * check-in lives at /checkin and is unaffected.
 */
export default async function GatePage() {
  await requireRole(
    "REGISTRATION_TILL",
    "REGISTRATION_NO_TILL",
    "STATION_VOLUNTEER",
    "POS_TILL",
  );

  const event = await getActiveGeneralEvent();

  if (!event) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">No active event</h1>
        <p className="mt-2 text-sm text-gray-600">
          The gate opens for an <span className="font-medium">ACTIVE</span>{" "}
          general event. Set one up in camp/event admin and mark it active.
        </p>
        <Link
          href="/admin/camps"
          className="mt-6 inline-block text-sm text-brand underline"
        >
          → Event admin
        </Link>
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
        id="gate"
        title="Gate"
        subtitle={event.name}
        items={[
          {
            label: "Scan to admit",
            body: "Keep the camera up and scan ticket QRs one after another. Each scan shows the guest and what they’re owed or owe.",
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

      <GateStation
        eventId={event.id}
        eventName={event.name}
        initialHeadcount={headcount}
        catalog={catalog}
      />
    </main>
  );
}
