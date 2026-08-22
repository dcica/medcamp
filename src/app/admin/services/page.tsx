import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { CatalogueManager } from "./CatalogueManager";

export const dynamic = "force-dynamic";

/**
 * The org-wide service catalogue. Split out of each event's services screen
 * because a name, colour or kind edit made there looked local and was not — one
 * rename reached every event that offered the service. Here the blast radius is
 * stated on the card.
 */
export default async function ServiceCataloguePage() {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) notFound();

  const services = await db.serviceType.findMany({
    where: { orgId: org.id },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { caps: true } } },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Service catalogue</h2>
        <p className="text-xs text-gray-500">
          Everything the organisation can sell. Each event picks from this list
          and sets its own prices and limits.
        </p>
      </div>

      <PageHelp
        id="admin-catalogue"
        items={[
          {
            label: "Shared by every event",
            body: "A service defined here can be offered at any event. Editing its name, colour or kind changes it at every event that already offers it.",
          },
          {
            label: "Kind",
            body: "Admission issues a scannable ticket and counts toward the door headcount. Merchandise is a physical good handed over at the gate. Entry fee buys a slot and admits nobody. Each service is exactly one of the three.",
          },
          {
            label: "People admitted per unit",
            body: "Only asked for an admission. A 'family of 4' is one purchase and 4 people through the door; leaving it at 1 would turn three of them away.",
          },
          {
            label: "Price here vs price at an event",
            body: "There is no price on this screen. Price lives on each event's offering, so the same service can cost different amounts at different events.",
          },
          {
            label: "Inactive",
            body: "Hides a service from new offerings and from registration without deleting the history of what was already sold.",
          },
        ]}
      />

      <CatalogueManager
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          colorHex: s.colorHex,
          kind: s.kind,
          admitsCount: s.admitsCount,
          hasLab: s.hasLab,
          active: s.active,
          eventCount: s._count.caps,
        }))}
      />
    </div>
  );
}
