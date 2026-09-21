import Link from "next/link";
import { requireCoordinator } from "@/server/admin";
import { db } from "@/lib/db";
import { formatVenueDate, formatVenueTime } from "@/lib/eventTime";
import { ERROR_LOG_RETENTION_DAYS } from "@/lib/errorSink";
import { PageHelp } from "@/app/_components/PageHelp";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = PRIVATE_PAGE_METADATA;

/**
 * What broke, grouped, and still here in the morning.
 *
 * Without this the error table is write-only, and a write-only table is worse
 * than no table: it costs storage, carries scrubbed-but-real data, and nobody
 * ever finds out whether it works.
 *
 * GROUPED BY FINGERPRINT, not listed by time. One failing loop can produce
 * hundreds of identical rows, and a reverse-chronological list then buries the
 * single unrelated error that actually explains the evening. The count IS the
 * signal — "this happened 340 times" and "this happened once" need different
 * responses.
 *
 * Coordinator-only: rows carry scrubbed field data and stack traces.
 */
export default async function ErrorsPage() {
  await requireCoordinator();

  const groups = await db.errorLog.groupBy({
    by: ["fingerprint", "level", "message", "errorName"],
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 50,
  });

  const total = await db.errorLog.count();

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <PageHelp
        id="admin-errors"
        title="Errors"
        subtitle={`${total} recorded, kept ${ERROR_LOG_RETENTION_DAYS} days`}
        items={[
          {
            label: "Why this exists",
            body: "The hosting platform only keeps logs for about two hours. This table is what is still here the next morning.",
          },
          {
            label: "Grouped, not listed",
            body: "Identical failures are collapsed. A count of 300 is a loop; a count of 1 is usually the interesting one.",
          },
          {
            label: "Safe to read",
            body: "Tokens, passwords and signatures are stripped before anything is written. Names and emails may appear.",
          },
        ]}
      />

      {groups.length === 0 ? (
        <p className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
          Nothing has gone wrong in the last {ERROR_LOG_RETENTION_DAYS} days.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {groups.map((g) => (
            <li
              key={g.fingerprint}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{g.message}</p>
                  {g.errorName && (
                    <p className="mt-0.5 font-mono text-xs text-gray-500">
                      {g.errorName}
                    </p>
                  )}
                </div>
                {/* Weight, not colour. verify-branding §8 keeps the status
                    palette for things a volunteer reads at a door; this is an
                    admin screen and a red badge here would cheapen it. */}
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold tabular-nums">
                  ×{g._count._all}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {g.level} · last seen{" "}
                {g._max.createdAt
                  ? `${formatVenueDate(g._max.createdAt)} ${formatVenueTime(g._max.createdAt)}`
                  : "—"}
              </p>
              <Link
                href={`/admin/errors/${g.fingerprint}`}
                className="mt-2 inline-block min-h-tap text-sm text-brand underline"
              >
                → Occurrences
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
