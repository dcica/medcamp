import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
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
