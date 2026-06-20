import Link from "next/link";
import { requireRole } from "@/server/session";
import { getDashboard } from "@/server/dashboard";
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

  if (!data) {
    return (
      <main className="mx-auto max-w-screen-md px-4 py-8">
        <h1 className="text-2xl font-bold text-brand">Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">No active camp.</p>
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
          <a
            href="/api/reports/reconciliation"
            className="text-sm text-brand underline"
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

      <p className="mt-8 text-center text-xs text-gray-400">
        <Link href="/admin" className="text-brand underline">
          Admin setup
        </Link>{" "}
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
