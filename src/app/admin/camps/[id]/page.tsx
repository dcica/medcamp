import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { CampControls } from "./CampControls";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  OPEN: "bg-green-100 text-green-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  CLOSED: "bg-amber-100 text-amber-700",
  PURGEABLE: "bg-orange-100 text-orange-700",
  PURGED: "bg-gray-200 text-gray-500",
};

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();

  const camp = org
    ? await db.event.findFirst({
        where: { id, orgId: org.id },
        include: {
          _count: { select: { caps: true, stations: true, attendees: true } },
        },
      })
    : null;

  if (!camp) notFound();

  return (
    <div className="space-y-6">
      <Link href="/admin/camps" className="text-sm text-brand underline">
        ← Camps
      </Link>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{camp.name}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[camp.status]}`}
          >
            {camp.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {camp.code} · {camp.startsAt.toLocaleString()} →{" "}
          {camp.endsAt.toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {camp._count.caps} services · {camp._count.stations} stations ·{" "}
          {camp._count.attendees} registered
          {camp.walkInOpensAt ? " · walk-in OPEN" : ""}
        </p>
      </div>

      <PageHelp
        id="admin-camp-detail"
        items={[
          {
            label: "Services & caps",
            body: "Set the service menu and the per-camp capacity limit for each service.",
          },
          {
            label: "Stations",
            body: "Define the stations and the order patients route through them (the Care Spine).",
          },
          {
            label: "Lifecycle",
            body: "Move the camp through DRAFT → OPEN → ACTIVE → CLOSED, and toggle walk-in registration on camp day.",
          },
          {
            label: "Purging",
            body: "After CLOSED, purging removes camp-scoped patient records. No clinical data (PHI) is ever stored to begin with.",
          },
        ]}
      />

      {/* Config sub-screens */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/admin/camps/${camp.id}/services`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Services &amp; caps →
        </Link>
        <Link
          href={`/admin/camps/${camp.id}/stations`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Stations →
        </Link>
        <Link
          href={`/admin/camps/${camp.id}/volunteers`}
          className="rounded-lg border border-gray-200 bg-white p-3 text-sm font-medium"
        >
          Volunteer roles →
        </Link>
      </div>

      {/* Lifecycle */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Lifecycle
        </h3>
        <CampControls
          id={camp.id}
          status={camp.status}
          walkInOpen={Boolean(camp.walkInOpensAt)}
        />
      </div>
    </div>
  );
}
