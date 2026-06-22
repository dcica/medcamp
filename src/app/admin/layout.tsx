import { requireAdmin } from "@/server/admin";
import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

/**
 * Admin portal shell. Gates the whole /admin tree to coordinator/committee-admin
 * (middleware is the optimistic gate; this is authoritative). Coordinator-only
 * sub-screens re-check inside their own pages. The site header/footer come from
 * the root layout — this shell only adds the admin title bar and section nav.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const member = await requireAdmin();

  return (
    <main className="mx-auto w-full max-w-screen-md px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand">Admin</h1>
        <span className="text-xs text-gray-500">{member.role}</span>
      </div>
      <AdminNav isCoordinator={member.role === "COORDINATOR"} />
      {children}
    </main>
  );
}
