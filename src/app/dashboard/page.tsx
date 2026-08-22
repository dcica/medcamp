import Link from "next/link";
import { requireRole } from "@/server/session";
import { getDashboard } from "@/server/dashboard";
import { getTrackedEvents } from "@/server/events";
import { getActiveOrg } from "@/lib/tenant";
import { formatCents } from "@/lib/money";
import { PageHelp } from "@/app/_components/PageHelp";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

/**
 * Coordinator dashboard (Module 4) — real-time-ish god view: flow stats, queue
 * depths with bottleneck alerts, payment summary, reconciliation export.
 */
export default async function DashboardPage() {
  await requireRole("COORDINATOR", "COMMITTEE_ADMIN");
  const data = await getDashboard();

  // Nothing is RUNNING — the normal state for most of the year. That is not the
  // same as nothing happening: events are selling, deadlines are closing, and
  // finished events may still be open. This used to read "No active camp." and
  // stop, which is how $238.50 of Garba sales and a 160-day-stale ACTIVE event
  // stayed invisible.
  if (!data) {
    const org = await getActiveOrg();
    const tracked = org ? await getTrackedEvents(org.id) : [];
    return (
      <main className="mx-auto max-w-screen-md px-4 py-8">
        <h1 className="text-2xl font-bold text-brand">Nothing running today</h1>
        <p className="mt-2 text-sm text-gray-600">
          {tracked.length > 0
            ? "No event is live right now. Here's what's being tracked."
            : "No event is live, and nothing is currently selling."}
        </p>

        {tracked.length > 0 && (
          <ul className="mt-6 space-y-3">
            {tracked.map((e) => (
              <li
                key={e.id}
                className={`rounded-xl border bg-white p-4 ${
                  e.isStale ? "border-amber-300" : "border-gray-200"
                }`}
              >
                <Link
                  href={`/admin/camps/${e.id}`}
                  className="flex min-h-tap flex-col justify-center"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-gray-900">{e.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {e.daysUntil >= 0
                        ? `in ${e.daysUntil}d`
                        : `${Math.abs(e.daysUntil)}d ago`}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    {e.sold} sold
                    {e.capacity > 0 ? ` of ${e.capacity}` : ""} ·{" "}
                    {formatCents(e.revenueCents)}
                  </div>
                  {e.isStale && (
                    <div className="mt-2 text-xs font-medium text-amber-800">
                      Finished {Math.abs(e.daysUntil)} days ago but still{" "}
                      {e.status} — close it
                    </div>
                  )}
                  {e.earlyBirdEndsAt && (
                    <div className="mt-1 text-xs text-gray-500">
                      Early bird ends{" "}
                      {e.earlyBirdEndsAt.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/admin/camps" className="text-brand underline">
            All camps &amp; events →
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-md px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand">{data.campName}</h1>
          <p className="text-sm text-gray-500">
            {data.campStatus}
            {data.walkInOpen ? " · walk-in OPEN" : ""}
          </p>
        </div>
        <AutoRefresh />
      </div>

      <PageHelp
        id="dashboard"
        items={[
          {
            label: "Flow stats",
            body: "Patient counts across the journey. “Needs payment” turns red when on-site add-ons are awaiting payment.",
          },
          {
            label: "Queue depths",
            body: "Waiting and active counts per station. A red “bottleneck” tag flags a station that's backing up — consider moving help there.",
          },
          {
            label: "Payments",
            body: "Total collected, broken down by method. Export the reconciliation CSV for the treasurer here.",
          },
          {
            label: "Live view",
            body: "The page auto-refreshes every 10s. Walk-in registration is opened or held from the camp's admin page.",
          },
        ]}
      />

      {/* Flow stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Registered" value={data.stats.registered} />
        <Stat label="Checked in" value={data.stats.checkedIn} />
        <Stat label="In flight" value={data.stats.inFlight} />
        <Stat label="Completed" value={data.stats.completed} />
        <Stat
          label="Needs payment"
          value={data.stats.needsPayment}
          alert={data.stats.needsPayment > 0}
        />
      </div>

      {/* Queue depths */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Queue depths
        </h2>
        <ul className="space-y-2">
          {data.stations.map((s) => (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-lg border bg-white p-3 ${
                s.bottleneck ? "border-red-300 bg-red-50" : "border-gray-200"
              }`}
            >
              <span
                className="inline-block h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: s.colorHex ?? "#888" }}
              />
              <span className="flex-1 font-medium">{s.name}</span>
              {s.bottleneck && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  bottleneck
                </span>
              )}
              <span className="text-sm text-gray-600">
                <strong>{s.waiting}</strong> waiting
                <span className="mx-1 text-gray-300">·</span>
                {s.inProgress} active
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Payments */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Payments
          </h2>
          {/* min-h-tap: this rendered at 20px against the mandated 48px, and it
              is the treasurer's money export being thumbed on a phone. */}
          <a
            href="/api/reports/reconciliation"
            className="flex min-h-tap items-center text-sm text-brand underline"
          >
            Export reconciliation CSV ↓
          </a>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-500">Collected</span>
            <span className="text-2xl font-bold">
              {formatCents(data.payments.collectedCents)}
            </span>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {data.payments.byMethod.map((m) => (
              <li key={m.method} className="flex justify-between text-gray-600">
                <span>
                  {m.method} ({m.count})
                </span>
                <span>{formatCents(m.cents)}</span>
              </li>
            ))}
            {data.payments.byMethod.length === 0 && (
              <li className="text-gray-400">No payments yet.</li>
            )}
          </ul>
          {data.payments.pendingAddonCount > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {data.payments.pendingAddonCount} on-site add-on(s) awaiting payment
              — {formatCents(data.payments.pendingAddonCents)}
            </p>
          )}
        </div>
      </section>

      <p className="mt-8 flex flex-wrap items-center justify-center gap-x-2 text-center text-xs text-gray-400">
        <Link
          href="/admin"
          className="inline-flex min-h-tap items-center text-brand underline"
        >
          Admin setup
        </Link>
        · auto-refreshes every 10s
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        alert ? "border-red-300 bg-red-50" : "border-gray-200"
      }`}
    >
      <div className={`text-2xl font-bold ${alert ? "text-red-700" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
