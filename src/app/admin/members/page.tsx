import { requireCoordinator } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
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
    <div className="space-y-5">
      <PageHelp
        id="admin-members"
        items={[
          {
            label: "Roles",
            body: "Each member's role controls what they can see — coordinator, registration desk, station volunteer, doctor, and so on.",
          },
          {
            label: "Till",
            body: "Only till-holders can take cash. Everyone else sees Stripe-only on the payment screen.",
          },
          {
            label: "Waiver override",
            body: "Lets a member check a patient in without a signed waiver. Grant sparingly — it's logged.",
          },
          {
            label: "Invites",
            body: "Pending invites stay listed here until the person signs in and accepts.",
          },
        ]}
      />
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
    </div>
  );
}
