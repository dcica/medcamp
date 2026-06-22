import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { ServicesManager } from "./ServicesManager";

export const dynamic = "force-dynamic";

/**
 * Service menu (org-level) + capacity caps (per camp). Editing a service changes
 * it org-wide; the capacity applies to this camp only.
 */
export default async function CampServicesPage({
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

  const services = await db.serviceType.findMany({
    where: { orgId: org.id },
    orderBy: { name: "asc" },
    include: {
      caps: { where: { eventId: id } },
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/camps/${id}`} className="text-sm text-brand underline">
          ← {camp.name}
        </Link>
        <h2 className="mt-2 text-lg font-bold">Services &amp; caps</h2>
        <p className="text-xs text-gray-500">
          Catalogue is shared across camps; price, capacity, and which services
          are offered apply to this camp only.
        </p>
      </div>

      <PageHelp
        id="admin-services"
        items={[
          {
            label: "Catalogue vs camp",
            body: "Name, color, lab, and merch are catalogue attributes shared across every camp. Price, capacity, and whether the service is offered are per-camp — the same service can cost different amounts at different events.",
          },
          {
            label: "Offered at this camp",
            body: "Untick to drop a catalogue service from THIS camp — it won't appear in this event's registration. Not all services are offered at every event.",
          },
          {
            label: "Capacity",
            body: "The cap applies to THIS camp only. Registration stops selling a service once its sold count reaches the cap.",
          },
          {
            label: "Lab",
            body: "Flag services that produce a result you'll mail back, so they show up in lab tracking.",
          },
          {
            label: "Merch",
            body: "Flag a physical good (e.g. dandiya sticks, T-shirt) so it shows as a hand-over item at the event gate.",
          },
          {
            label: "Active",
            body: "Inactive services are hidden from the registration form without deleting their history.",
          },
        ]}
      />

      <ServicesManager
        eventId={id}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          // Per-event price (cap) when offered here; else the catalogue default
          // as a starting point for a new offering.
          priceDollars: (s.caps[0]?.priceCents ?? s.priceCents) / 100,
          colorHex: s.colorHex,
          hasLab: s.hasLab,
          fulfillable: s.fulfillable,
          active: s.active,
          offered: s.caps.length > 0,
          capacity: s.caps[0]?.capacity ?? 0,
          sold: s.caps[0]?.sold ?? 0,
        }))}
      />
    </div>
  );
}
