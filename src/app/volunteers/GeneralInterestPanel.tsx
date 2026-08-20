import { ageBandLabel } from "@/lib/volunteerRoles";
import type { GeneralInterestRow } from "@/server/volunteers";

/**
 * The general-interest pool: people who registered to volunteer without an
 * event attached, and have not since signed up for one.
 *
 * This exists so the public form is not a trap. The roster beside it is scoped
 * to a single event by design, so a volunteer with no signup appears nowhere in
 * it — the rows would be written and never read, which looks like the feature
 * works and is worse than not having it. Rendered in both states of the
 * dashboard, including when no event is open, because "no event is open" is
 * precisely when this list is the only thing there is to look at.
 *
 * Newest first: the useful question is who has come in since the coordinator
 * last looked, not who is alphabetically first.
 */
export function GeneralInterestPanel({ rows }: { rows: GeneralInterestRow[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-brand">General interest</h2>
        <span className="text-sm text-gray-500">
          {rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-gray-600">
        Registered to volunteer but not yet signed up for any event. Contact them
        when signups open — nothing is sent automatically.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          Nobody yet. The signup form lives at{" "}
          <span className="font-medium">/volunteer</span>.
        </p>
      ) : (
        // Cards, not a table: the coordinator dashboard has to be readable on a
        // 6" phone, and a 7-column table cannot be without horizontal scroll.
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-gray-200 p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold text-gray-900">{r.name}</span>
                <span className="text-xs text-gray-500">
                  {r.registeredAt.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>

              {/* Tappable on a phone — a coordinator working this list is
                  reaching out, not reading it. */}
              <div className="mt-1 flex flex-col gap-0.5">
                <a
                  href={`mailto:${r.email}`}
                  className="min-h-tap flex items-center text-brand underline"
                >
                  {r.email}
                </a>
                {r.phone && (
                  <a
                    href={`tel:${r.phone}`}
                    className="min-h-tap flex items-center text-brand underline"
                  >
                    {r.phone}
                  </a>
                )}
              </div>

              <dl className="mt-1 text-xs text-gray-600">
                <div className="flex gap-1">
                  <dt className="font-medium">Age:</dt>
                  <dd>{ageBandLabel(r.ageBand)}</dd>
                </div>
                {r.school && (
                  <div className="flex gap-1">
                    <dt className="font-medium">School / org:</dt>
                    <dd>{r.school}</dd>
                  </div>
                )}
                {r.skills && (
                  <div className="flex gap-1">
                    <dt className="font-medium">Can help with:</dt>
                    <dd>{r.skills}</dd>
                  </div>
                )}
                {r.languages && (
                  <div className="flex gap-1">
                    <dt className="font-medium">Languages:</dt>
                    <dd>{r.languages}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
