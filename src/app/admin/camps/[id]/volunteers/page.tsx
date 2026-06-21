import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { VolunteerRolesManager, type RoleRow } from "./VolunteerRolesManager";

export const dynamic = "force-dynamic";

const OCCUPYING = ["SIGNED_UP", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW"] as const;

/**
 * Per-event volunteer role configuration (Module 9 §3). Config-over-code, same
 * shape as Services/Stations admin. Volunteer Coordinator + admins.
 */
export default async function CampVolunteerRolesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();

  const camp = org
    ? await db.event.findFirst({ where: { id, orgId: org.id } })
    : null;
  if (!camp) notFound();

  const roles = await db.volunteerRole.findMany({
    where: { eventId: id },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { signups: { where: { status: { in: [...OCCUPYING] } } } } },
    },
  });

  const rows: RoleRow[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    minAge: r.minAge,
    capacity: r.capacity,
    filled: r._count.signups,
    shift: r.shift,
    instructions: r.instructions,
    requiresClearance: r.requiresClearance,
    active: r.active,
  }));

  return (
    <div className="space-y-6">
      <Link href={`/admin/camps/${id}`} className="text-sm text-brand underline">
        ← {camp.name}
      </Link>

      <PageHelp
        id="admin-volunteer-roles"
        title="Volunteer roles"
        subtitle="Configure the roles, age rules, and target counts for this event."
        items={[
          {
            label: "Min age",
            body: "Gates who can sign up for the role — for suitability and supervision, not clinical work.",
          },
          {
            label: "Target count",
            body: "The role shows 'Full' on the signup form once met; extra signups go to the waitlist.",
          },
          {
            label: "Instructions",
            body: "Surfaced in the confirmation email and on the day-of sign-in screen.",
          },
          {
            label: "Inactive vs delete",
            body: "A role with signups can't be deleted — set it inactive to hide it from new signups while keeping its roster.",
          },
        ]}
      />

      <VolunteerRolesManager eventId={id} roles={rows} />
    </div>
  );
}
