import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { CreateCampForm } from "./CreateCampForm";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  OPEN: "bg-green-100 text-green-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  CLOSED: "bg-amber-100 text-amber-700",
  PURGEABLE: "bg-orange-100 text-orange-700",
  PURGED: "bg-gray-200 text-gray-500",
};

export default async function CampsPage() {
  await requireAdmin();
  const org = await getActiveOrg();
  const camps = org
    ? await db.event.findMany({
        where: { orgId: org.id },
        orderBy: { startsAt: "desc" },
      })
    : [];

  return (
    <div className="space-y-5">
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
                {c.code} · {c.startsAt.toLocaleDateString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
