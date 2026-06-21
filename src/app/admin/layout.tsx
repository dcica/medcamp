import { requireAdmin } from "@/server/admin";
import { SiteHeader } from "@/app/_components/SiteHeader";
import { SiteFooter } from "@/app/_components/SiteFooter";
import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

/**
 * Admin portal shell. Gates the whole /admin tree to coordinator/committee-admin
 * (middleware is the optimistic gate; this is authoritative). Coordinator-only
 * sub-screens re-check inside their own pages. Wrapped in the site header/footer
 * with the footer pinned to the bottom on short pages (min-h-screen flex column).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const member = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-brand">Admin</h1>
          <span className="text-xs text-gray-500">{member.role}</span>
        </div>
        <AdminNav isCoordinator={member.role === "COORDINATOR"} />
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
