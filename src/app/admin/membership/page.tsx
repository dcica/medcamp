import { requireCoordinator } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { PlansManager } from "./PlansManager";
import { MemberSearch } from "./MemberSearch";

export const dynamic = "force-dynamic";

/** Family membership plans (org-level catalogue) — coordinator-only. */
export default async function MembershipPage() {
  await requireCoordinator();
  const org = await getActiveOrg();
  const [plans, memberCount] = org
    ? await Promise.all([
        db.membershipPlan.findMany({
          where: { orgId: org.id },
          orderBy: { termYears: "asc" },
        }),
        db.member.count({ where: { orgId: org.id } }),
      ])
    : [[], 0];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Member roster
        </h2>
        <MemberSearch total={memberCount} />
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Family membership plans
      </h2>
      <PageHelp
        id="admin-membership"
        items={[
          {
            label: "Plans",
            body: "Family membership sold on 1/2/5-year terms (no tiers). Price and family size are per plan.",
          },
          {
            label: "Free entry",
            body: "On events with 'honors membership' on, a member's family is admitted free — the registration form shows membership as a compare against buying admission.",
          },
          {
            label: "Active",
            body: "Inactive plans are hidden from the registration form without deleting their history.",
          },
        ]}
      />
      <div className="mt-4" />
      <PlansManager
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          termYears: p.termYears,
          priceDollars: p.priceCents / 100,
          partySize: p.partySize,
          active: p.active,
        }))}
      />
    </div>
  );
}
