import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { formatVenueDate } from "@/lib/eventTime";
import { STATUS_STYLE } from "@/lib/eventLifecycle";
import { PageHelp } from "@/app/_components/PageHelp";
import { CreateCampForm } from "./CreateCampForm";
import { Breadcrumbs, campTrail } from "@/app/_components/Breadcrumbs";

export const dynamic = "force-dynamic";

export default async function CampsPage() {
  await requireAdmin();
  const org = await getActiveOrg();
  // Soonest first. This was `desc`, which put 2027 at the top and buried the
  // next real event — Rhythms of Navratri, 10 Oct — seventh of eleven. A
  // coordinator opens this list to find what is happening next, not what was
  // created last.
  const camps = org
    ? await db.event.findMany({
        where: { orgId: org.id },
        orderBy: { startsAt: "asc" },
      })
    : [];

  return (
    <div className="space-y-5">
      {/* This page had NO route back to the dashboard. Following
          dashboard -> camp -> registrations and stepping back landed here
          and stopped, one page short of where the trail started. */}
      <Breadcrumbs trail={campTrail({})} />
      <PageHelp
        id="admin-camps"
        items={[
          {
            label: "Create a camp",
            body: "Give it a name and dates. A camp code (MC-YYYY[S|W]-NNNN) is generated automatically.",
          },
          {
            label: "Camp list",
            body: "Tap any camp to set its services, stations, and lifecycle. Newest camps appear first.",
          },
        ]}
      />
      <CreateCampForm />

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
                {/* Venue day — an admin list must agree with the public page
                    and the flyer about what date an event is on. Through the
                    shared helper, not an inline `toLocaleDateString`: this row
                    printed `3/14/2026` while the admin overview one tap away
                    printed `Sep 19, 2026` for the same kind of row. */}
                {c.code} · {formatVenueDate(c.startsAt)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
