import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { StationsManager } from "./StationsManager";

export const dynamic = "force-dynamic";

/** Stations & routing order (the default Care Spine rail). Colors auto-assigned. */
export default async function CampStationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();
  if (!org) notFound();

  const camp = await db.event.findFirst({ where: { id, orgId: org.id } });
  if (!camp) notFound();

  const stations = await db.station.findMany({
    where: { eventId: id },
    orderBy: { sequence: "asc" },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/camps/${id}`} className="text-sm text-brand underline">
          ← {camp.name}
        </Link>
        <h2 className="mt-2 text-lg font-bold">Stations</h2>
        <p className="text-xs text-gray-500">
          Order is the default route applied to each attendee at confirmation.
        </p>
      </div>

      <PageHelp
        id="admin-stations"
        items={[
          {
            label: "Order",
            body: "The sequence here is the default route stamped onto each attendee's badge at confirmation.",
          },
          {
            label: "Colors",
            body: "Auto-assigned per station. The same color shows on badge dots and the station queue header.",
          },
          {
            label: "Active",
            body: "Inactive stations are skipped when routing patients — useful when a station isn't running this camp.",
          },
        ]}
      />

      <StationsManager
        eventId={id}
        stations={stations.map((s) => ({
          id: s.id,
          name: s.name,
          colorHex: s.colorHex,
          active: s.active,
        }))}
      />
    </div>
  );
}
