import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { getActiveOrg } from "@/lib/tenant";
import { resolveOrgDonations } from "@/lib/orgSettings";
import { getDonorRows } from "@/server/donations";
import { PageHelp } from "@/app/_components/PageHelp";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";

export const dynamic = "force-dynamic";

/**
 * The donor list: every gift received in a year, whether made on /donate or
 * added to a ticket order, with a CSV of the same rows. Read-only: a receipt
 * was emailed when the money landed, and a correction is a refund, not an
 * edit here.
 */
export default async function DonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) notFound();
  const { year: rawYear } = await searchParams;
  const thisYear = new Date().getFullYear();
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : thisYear;
  const [rows, policy] = [await getDonorRows(org.id, { year }), resolveOrgDonations(org.settings)];
  const totalCents = rows.reduce((s, r) => s + Math.round(Number(r.amount_usd) * 100), 0);

  return (
    <div className="space-y-5">
      <Breadcrumbs trail={[{ href: "/admin", label: "Admin" }, { label: "Donations" }]} />
      <div>
        <h2 className="text-lg font-bold">Donations {year}</h2>
        <p className="text-xs text-gray-500">
          Money received, on the venue&apos;s calendar. The donate page is{" "}
          {policy.enabled ? "open" : "off"} — change that under Settings.
        </p>
      </div>
      <PageHelp
        id="admin-donations"
        items={[
          {
            label: "What is listed",
            body: "Every donation that was paid: gifts made on the donate page (event 'general') and donations added to a ticket order (under that event's code). A gift somebody started and did not pay is not here.",
          },
          {
            label: "Receipts",
            body: "A receipt was emailed when each gift cleared, with your legal name, EIN and receipt sentence from Settings exactly as entered. This list is for your year-end records.",
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
          <Link
            key={y}
            href={`/admin/donations?year=${y}`}
            className={`inline-flex min-h-tap items-center rounded-lg border px-3 ${
              y === year ? "border-brand bg-brand/5 font-semibold text-brand" : "border-gray-300 text-gray-700"
            }`}
          >
            {y}
          </Link>
        ))}
        <a
          href={`/api/reports/donations?year=${year}`}
          className="ml-auto inline-flex min-h-tap items-center text-brand underline"
        >
          Download CSV
        </a>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">
            {rows.length} gift{rows.length === 1 ? "" : "s"}
          </span>
          <span className="text-2xl font-bold">${(totalCents / 100).toFixed(2)}</span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Nothing received in {year}.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {rows.map((r) => (
              <li key={`${r.order}-${r.date}-${r.amount_usd}`} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{r.donor}</span>
                  <span className="block break-all text-xs text-gray-500">
                    {r.email} · {r.date} · {r.event}
                    {r.honoree ? ` · in honour of ${r.honoree}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">${r.amount_usd}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
