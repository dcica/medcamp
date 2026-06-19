import { requireCoordinator } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { MembersManager } from "./MembersManager";

export const dynamic = "force-dynamic";

/** Members, roles & till — coordinator-only. */
export default async function MembersPage() {
  const me = await requireCoordinator();
  const org = await getActiveOrg();

  const memberships = org
    ? await db.membership.findMany({
        where: { orgId: org.id },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const invites = org
    ? await db.invite.findMany({
        where: { orgId: org.id, acceptedAt: null },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <MembersManager
      members={memberships.map((m) => ({
        id: m.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        canHoldTill: m.canHoldTill,
        canOverrideWaiver: m.canOverrideWaiver,
        isSelf: m.userId === me.userId,
      }))}
      invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role }))}
    />
  );
}
