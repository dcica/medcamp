import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/session";
import { getStationQueue, addableServices } from "@/server/stations";
import { QueueView } from "./QueueView";

export const dynamic = "force-dynamic";

/** Live per-station queue. Doctors/coordinators can add on-site services. */
export default async function StationQueuePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const member = await requireRole("STATION_VOLUNTEER", "DOCTOR");
  const { key } = await params;

  const queue = await getStationQueue(key);
  if (!queue) notFound();

  const canAddOn = member.role === "DOCTOR" || member.role === "COORDINATOR";
  const services = canAddOn ? await addableServices() : [];

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <Link href="/station" className="text-sm text-brand underline">
        ← Stations
      </Link>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-brand">{queue.stationName}</h1>
        <span className="text-xs text-gray-500">{queue.campName}</span>
      </div>

      <QueueView
        stationKey={queue.stationKey}
        inProgress={queue.inProgress}
        waiting={queue.waiting}
        canAddOn={canAddOn}
        services={services}
      />
    </main>
  );
}
