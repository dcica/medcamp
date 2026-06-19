import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Coordinator dashboard stub. Proves the IAM layer: requireRole redirects
 * unauthenticated users to /login and non-coordinators to /403. The real
 * dashboard (queue depths, payments, reconciliation) is Module 4.
 */
export default async function DashboardPage() {
  const member = await requireRole("COORDINATOR");

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <h1 className="text-2xl font-bold text-brand">Coordinator dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">Signed in — access confirmed.</p>

      <dl className="mt-6 space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Email</dt>
          <dd className="font-medium">{member.email}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Role</dt>
          <dd className="font-medium">{member.role}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Can hold till</dt>
          <dd className="font-medium">{member.canHoldTill ? "Yes" : "No"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Org</dt>
          <dd className="font-mono text-xs">{member.orgId}</dd>
        </div>
      </dl>
    </main>
  );
}
