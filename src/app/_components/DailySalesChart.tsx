import { formatCents } from "@/lib/money";
import type { DailySalesDay } from "@/server/dashboard";

/**
 * Purchases per day — units and money.
 *
 * TWO CHARTS, NOT ONE WITH TWO AXES. Units and dollars are different scales,
 * and overlaying them on a shared y-axis invents a correlation that is not in
 * the data: the alignment of the two scales would be arbitrary, so a day where
 * the bars happen to match would read as meaningful. Stacked, sharing a date
 * axis, each with its own peak labelled — the comparison a reader can actually
 * make is "which days were busy", and both charts answer it honestly.
 *
 * NO CHART LIBRARY. Two rows of rects is not worth a dependency, and every
 * charting package ships a client bundle for something this page renders on the
 * server and never re-renders.
 *
 * NEUTRAL BARS, deliberately not the tenant brand. Colour here would carry no
 * information — one series, height already encodes the value — and this repo
 * keeps colour meaning scarce on purpose (CLAUDE.md: status colour is meaning,
 * not identity). A saffron bar chart beside amber status chips would spend a
 * signal a volunteer needs elsewhere.
 */

/** Plot geometry, in SVG user units. The viewBox scales it to the card. */
const PLOT_H = 48;
const BAR_GAP = 2; // surface gap between adjacent bars, never a border
const RADIUS = 2;

function Bars({
  days,
  values,
  peakLabel,
  title,
  describe,
}: {
  days: DailySalesDay[];
  values: number[];
  peakLabel: string;
  title: string;
  describe: (d: DailySalesDay) => string;
}) {
  const max = Math.max(...values, 1);
  const peak = values.indexOf(Math.max(...values));
  const slot = 100 / days.length;
  const barW = Math.max(slot - BAR_GAP, 1);

  return (
    <figure className="mt-3">
      <figcaption className="flex items-baseline justify-between text-xs">
        {/* One series, so the title names it and there is no legend box. */}
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </span>
        <span className="tabular-nums text-gray-500">peak {peakLabel}</span>
      </figcaption>
      <svg
        viewBox={`0 0 100 ${PLOT_H}`}
        preserveAspectRatio="none"
        className="mt-1 h-16 w-full"
        role="img"
        aria-label={`${title} per day. ${describe(days[peak])} was the busiest.`}
      >
        {/* Baseline only — a hairline one shade off the surface, never dashed. */}
        <line x1="0" y1={PLOT_H} x2="100" y2={PLOT_H} stroke="#e5e7eb" strokeWidth="0.5" />
        {values.map((v, i) => {
          const h = max === 0 ? 0 : (v / max) * (PLOT_H - 2);
          return (
            <rect
              key={days[i].day}
              x={i * slot + BAR_GAP / 2}
              y={PLOT_H - h}
              width={barW}
              height={h}
              rx={RADIUS}
              // Bars are anchored to the baseline; rx rounds the data-end.
              fill={i === peak ? "#334155" : "#94a3b8"}
            >
              {/* Native tooltip — no JS, and it survives a server render. */}
              <title>{describe(days[i])}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

export function DailySalesChart({ days }: { days: DailySalesDay[] }) {
  const units = days.map((d) => d.units);
  const cents = days.map((d) => d.cents);
  const totalUnits = units.reduce((s, n) => s + n, 0);
  const totalCents = cents.reduce((s, n) => s + n, 0);
  const active = days.filter((d) => d.units > 0 || d.cents > 0).length;

  const label = (iso: string) => {
    // Parsed as UTC noon: the key is already a venue calendar day, and letting
    // the browser re-interpret it in ITS zone would shift the label by a day
    // for anyone east of the venue.
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };

  // A one-bar bar chart is a stat tile wearing the wrong clothes. Below two
  // active days there is no shape to read, so show the numbers instead.
  if (active < 2) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Purchases</h2>
        <p className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
          {active === 0
            ? `Nothing sold in the last ${days.length} days.`
            : `${totalUnits} ${totalUnits === 1 ? "unit" : "units"} · ${formatCents(totalCents)} — all on one day, so there is no trend to plot yet.`}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Purchases</h2>
        <p className="text-xs text-gray-500">last {days.length} days</p>
      </div>

      <div className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm">
          <span className="text-xl font-bold tabular-nums">{totalUnits}</span>{" "}
          <span className="text-gray-600">
            {totalUnits === 1 ? "unit" : "units"}
          </span>
          <span className="mx-2 text-gray-300">·</span>
          <span className="text-xl font-bold tabular-nums">
            {formatCents(totalCents)}
          </span>
        </p>

        <Bars
          days={days}
          values={units}
          title="Units"
          peakLabel={String(Math.max(...units))}
          describe={(d) => `${label(d.day)}: ${d.units} units`}
        />
        <Bars
          days={days}
          values={cents}
          title="Collected"
          peakLabel={formatCents(Math.max(...cents))}
          describe={(d) => `${label(d.day)}: ${formatCents(d.cents)}`}
        />

        {/* Only the ends of the axis are labelled. A date under every bar is
            unreadable at 390px and goes unread anywhere. */}
        <div className="mt-1 flex justify-between text-xs tabular-nums text-gray-400">
          <span>{label(days[0].day)}</span>
          <span>{label(days[days.length - 1].day)}</span>
        </div>

        {/* The table view the bars are a picture OF. Collapsed so it costs no
            room, present so the data is reachable without hover — which a phone
            does not have at all. */}
        <details className="mt-3">
          <summary className="min-h-tap cursor-pointer text-xs text-gray-600">
            Show the numbers
          </summary>
          <table className="mt-2 w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="font-medium">Day</th>
                <th className="text-right font-medium">Units</th>
                <th className="text-right font-medium">Collected</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-t border-gray-100">
                  <td className="py-1">{label(d.day)}</td>
                  <td className="py-1 text-right">{d.units}</td>
                  <td className="py-1 text-right">{formatCents(d.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
