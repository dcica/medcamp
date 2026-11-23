import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";
import { listMemberships, safeThenPath } from "@/server/staffOrg";

export const dynamic = "force-dynamic";

export const metadata = PRIVATE_PAGE_METADATA;

/**
 * Pick the organisation to work in. Reached when a signed-in user lands on the
 * platform host with no organisation resolved (requireMember sends them here)
 * and from the staff menu's "Switch organisation". One membership needs no
 * choice and is selected straight away.
 */
export default async function StaffOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ then?: string }>;
}) {
  const { then } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fstaff%2Forg");

  const target = safeThenPath(then);
  const memberships = await listMemberships(session.user.id);
  const selectHref = (slug: string) =>
    `/api/org/select?slug=${encodeURIComponent(slug)}&then=${encodeURIComponent(target)}`;

  if (memberships.length === 1) redirect(selectHref(memberships[0].org.slug));

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-screen-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-bold text-brand">Which organisation?</h1>
      {memberships.length === 0 ? (
        <>
          <p className="mt-2 text-sm text-gray-600">
            No organisation has given this account access yet. Ask a coordinator
            to invite {session.user.email ?? "you"}, then sign in again.
          </p>
          <Link
            href="/api/auth/signout"
            className="mt-6 inline-flex min-h-tap w-fit items-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700"
          >
            Sign out
          </Link>
        </>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {memberships.map((m) => (
            <li key={m.org.id}>
              <Link
                href={selectHref(m.org.slug)}
                className="flex min-h-tap items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{m.org.name}</span>
                <span className="text-xs uppercase tracking-wide text-gray-500">{m.role.replaceAll("_", " ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
