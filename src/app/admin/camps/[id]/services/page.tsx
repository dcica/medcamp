import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { ServicesManager } from "./ServicesManager";

export const dynamic = "force-dynamic";

/**
 * Format a Date as the local "YYYY-MM-DDTHH:mm" string a datetime-local
 * input expects. Must round-trip exactly through `new Date(str)` on save
 * (see actions.ts's unchanged-deadline check) — using local components
 * here matches how the browser parses what it submits back.
 */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Seconds → "m:ss", the way performance lengths are quoted to a choreographer. */
function toDurationInput(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * What THIS event sells. The list is the event's own offerings (ServiceCap
 * rows), not the org catalogue with ticks against it: the old shape asked
 * "here is everything the org sells, which applies?" and answered a community
 * festival with eleven medical services, which is how a dance competition ended
 * up attached to a medical camp. The catalogue is now reachable only through
 * the Add picker.
 */
export default async function EventServicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();
  if (!org) notFound();

  const event = await db.event.findFirst({ where: { id, orgId: org.id } });
  if (!event) notFound();

  const [offerings, catalogue] = await Promise.all([
    db.serviceCap.findMany({
      where: { eventId: id, serviceType: { orgId: org.id } },
      orderBy: { serviceType: { name: "asc" } },
      include: { serviceType: true },
    }),
    // Inactive services are excluded: attaching one would offer something the
    // registration form is built to hide.
    db.serviceType.findMany({
      where: { orgId: org.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, colorHex: true, priceCents: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        {/* inline-flex + min-h-tap: as a bare inline link this back-out was an
            18px target, the smallest thing on the page. */}
        <Link
          href={`/admin/camps/${id}`}
          className="inline-flex min-h-tap items-center text-sm text-brand underline"
        >
          ← {event.name}
        </Link>
        <h2 className="mt-2 text-lg font-bold">What this event sells</h2>
        <p className="text-xs text-gray-500">
          Only these services appear in this event&apos;s registration. Prices and
          limits below apply to this event alone.
        </p>
      </div>

      <PageHelp
        id="admin-services"
        items={[
          {
            label: "This list is the event",
            body: "A service appears in this event's registration because it is in this list. Add one from the catalogue, or remove it — there is no separate 'offered' tick to forget.",
          },
          {
            label: "Catalogue vs event",
            body: "Name, colour and kind belong to the org catalogue and are shared by every event. Price, capacity, door price, early bird and competition rules are yours to set per event.",
          },
          {
            label: "Kind",
            body: "Admission issues a scannable ticket and counts toward the door headcount. Merchandise is a physical good handed over at the gate. Entry fee buys a slot and admits nobody — a competition entry.",
          },
          {
            label: "Capacity",
            body: "Unlimited means registration never stops selling. A limit stops sales once that many are sold; it can't be set below what's already sold.",
          },
          {
            label: "Removing",
            body: "A service that has already sold at this event can't be removed — the money and the ticket already exist.",
          },
        ]}
      />

      <ServicesManager
        eventId={id}
        offerings={offerings.map((c) => ({
          serviceTypeId: c.serviceTypeId,
          name: c.serviceType.name,
          colorHex: c.serviceType.colorHex,
          kind: c.serviceType.kind,
          admitsCount: c.serviceType.admitsCount,
          hasLab: c.serviceType.hasLab,
          priceDollars: c.priceCents / 100,
          onsitePriceDollars:
            c.onsitePriceCents === null ? null : c.onsitePriceCents / 100,
          earlyBirdPriceDollars:
            c.earlyBirdPriceCents === null ? null : c.earlyBirdPriceCents / 100,
          earlyBirdUntil:
            c.earlyBirdUntil === null ? null : toDatetimeLocal(c.earlyBirdUntil),
          capacity: c.capacity,
          sold: c.sold,
          minParticipants: c.minParticipants,
          maxParticipants: c.maxParticipants,
          minDuration: toDurationInput(c.minDurationSeconds),
          maxDuration: toDurationInput(c.maxDurationSeconds),
        }))}
        catalogue={catalogue.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          colorHex: s.colorHex,
          priceDollars: s.priceCents / 100,
        }))}
      />
    </div>
  );
}
