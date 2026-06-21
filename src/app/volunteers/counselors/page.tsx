import Link from "next/link";
import { requireVolunteerCoordinator } from "@/server/admin";
import { getCounselorRollup } from "@/server/volunteers";
import { PageHelp } from "@/app/_components/PageHelp";

export const dynamic = "force-dynamic";

/**
 * Counselor rollup (Module 9 §7 + recruitment). The persistent Counselor entity
 * accumulates the students, schools and verified hours that name it across every
 * event — turning each camp into a growing list of school advisors the org can
 * reach back to. The CSV export is the recruitment list.
 */
export default async function CounselorsPage() {
  await requireVolunteerCoordinator();
  const counselors = await getCounselorRollup();

  return (
    <main className="mx-auto max-w-screen-md px-4 py-6">
      <Link href="/volunteers" className="text-sm text-brand underline">
        ← Volunteers
      </Link>

      <div className="mt-3">
        <PageHelp
          id="volunteers-counselors"
          title="Counselors"
          subtitle="School advisors your volunteers submit hours to — a recruitment channel."
          items={[
            {
              label: "Why this matters",
              body: "Students sign up in cohorts through a counselor. Keep in touch with counselors and they send new students each term.",
            },
            {
              label: "Hours",
              body: "Total verified hours their students have served across all events — useful when you reach out.",
            },
            {
              label: "Export",
              body: "Download the contact list as CSV for an outreach email before the next event.",
            },
          ]}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <a
          href="/api/reports/counselors"
          className="min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium"
        >
          Export counselors CSV ↓
        </a>
      </div>

      {counselors.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          No counselors captured yet. They&apos;re collected when students add their
          advisor at signup.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {counselors.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.name}
                    {c.title && (
                      <span className="text-gray-400"> · {c.title}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {c.school ?? "—"}
                  </p>
                  <a
                    href={`mailto:${c.email}`}
                    className="text-xs text-brand underline"
                  >
                    {c.email}
                  </a>
                </div>
                <div className="shrink-0 text-right text-xs text-gray-600">
                  <p>
                    <span className="font-semibold">{c.students}</span> students
                  </p>
                  <p>
                    <span className="font-semibold">{c.events}</span> events
                  </p>
                  <p>
                    <span className="font-semibold">{c.totalHours.toFixed(1)}</span> hrs
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
