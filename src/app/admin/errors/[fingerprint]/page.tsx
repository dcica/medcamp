import Link from "next/link";
import { requireCoordinator } from "@/server/admin";
import { db } from "@/lib/db";
import { formatVenueDate, formatVenueTime } from "@/lib/eventTime";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = PRIVATE_PAGE_METADATA;

/**
 * Individual occurrences of one grouped failure.
 *
 * The group view answers "what, and how often". This answers "what exactly was
 * happening", which needs the stack and the scrubbed fields — so it is its own
 * page rather than an expander, behind the same coordinator-only guard.
 */
export default async function ErrorGroupPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  await requireCoordinator();
  const { fingerprint } = await params;

  const rows = await db.errorLog.findMany({
    where: { fingerprint },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <Link href="/admin/errors" className="text-sm text-brand underline">
        ← All errors
      </Link>
      <h1 className="mt-3 break-words text-xl font-bold">
        {rows[0]?.message ?? "No occurrences"}
      </h1>
      <p className="mt-1 font-mono text-xs text-gray-500">{fingerprint}</p>

      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">
              {formatVenueDate(r.createdAt)} {formatVenueTime(r.createdAt)}
              {r.route ? ` · ${r.route}` : ""}
            </p>
            {r.errorMessage && (
              <p className="mt-2 break-words text-sm">{r.errorMessage}</p>
            )}
            {r.fields != null && (
              // Already scrubbed and size-capped on the way in — see
              // src/lib/errorScrub.ts. Rendered as text, never as markup.
              <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                {JSON.stringify(r.fields, null, 2)}
              </pre>
            )}
            {r.stack && (
              <details className="mt-2">
                <summary className="min-h-tap cursor-pointer text-xs text-gray-600">
                  Stack
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                  {r.stack}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
