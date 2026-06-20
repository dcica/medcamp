import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  OPEN: "bg-green-100 text-green-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  CLOSED: "bg-amber-100 text-amber-700",
  PURGEABLE: "bg-orange-100 text-orange-700",
  PURGED: "bg-gray-200 text-gray-500",
};

/** Admin overview: camps + setup-health counts at a glance. */
export default async function AdminOverview() {
  await requireAdmin();
  const org = await getActiveOrg();

  const camps = org
    ? await db.event.findMany({
        where: { orgId: org.id },
        orderBy: { startsAt: "desc" },
        include: {
          _count: { select: { caps: true, stations: true, attendees: true } },
        },
      })
    : [];

  const memberCount = org
    ? await db.membership.count({ where: { orgId: org.id } })
    : 0;

  return (
    <div className="space-y-6">
      <PageHelp
        id="admin-overview"
        items={[
          {
            label: "Camps",
            body: "Each card shows a camp's service, station, and registration counts. Tap one to configure it.",
          },
          {
            label: "Status colors",
            body: "A camp moves DRAFT → OPEN (taking registrations) → ACTIVE (camp day) → CLOSED → PURGED (patient data removed).",
          },
          {
            label: "Members",
            body: "The member count reflects everyone with a role in this organization. Manage them under the Members tab.",
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Camps" value={camps.length} />
        <Stat label="Members" value={memberCount} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Camps
          </h2>
          <Link href="/admin/camps" className="text-sm text-brand underline">
            Manage →
          </Link>
        </div>

        {camps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            No camps yet.{" "}
            <Link href="/admin/camps" className="text-brand underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {camps.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/camps/${c.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {c.code} · {c._count.caps} services · {c._count.stations}{" "}
                    stations · {c._count.attendees} registered
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
