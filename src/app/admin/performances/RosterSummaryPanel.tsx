import type { RosterSummary, ThreeState } from "@/server/performance";
import { MUSIC_FILTER_LABEL, MUSIC_STATES } from "@/lib/musicState";

/** "5:30" — the way a running order writes a track length. */
function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "1h 24m" / "2h" / "42m" — the way a coordinator talks about the show. */
function hm(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  // "4h", not "4h 0m" — a booked slot is quoted in whole hours and the extra
  // two characters are the ones that wrap the label in a 110px tile.
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The numbers above the roster.
 *
 * THREE headline figures and no more, because this is read on a phone between
 * other jobs and the fourth tile is what starts the horizontal scroll: how full
 * the competition is, whether the show fits the slot, and how much music is
 * still owed. Everything else is real but not urgent, so it sits behind a
 * disclosure — a native <details>, which needs no JavaScript and lets this stay
 * a server component.
 *
 * No interactivity here on purpose: the summary describes the SHOW, so it must
 * not move when the music filter below narrows the list. A summary that tracked
 * the filter would answer a different question every time someone tapped a chip.
 */
export function RosterSummaryPanel({ summary }: { summary: RosterSummary }) {
  const s = summary;
  const overSlot = s.slotSeconds !== null && s.showEstimateSeconds > s.slotSeconds;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Headline
          label={s.capacity === null ? "Entries" : "Entries of capacity"}
          value={s.capacity === null ? String(s.entries) : `${s.entries} / ${s.capacity}`}
        />
        <Headline
          label={
            s.slotSeconds === null ? "Show estimate" : `Show est. · slot ${hm(s.slotSeconds)}`
          }
          value={hm(s.showEstimateSeconds)}
          tone={overSlot ? "warn" : undefined}
        />
        <Headline
          label="Music outstanding"
          value={String(s.musicOutstanding)}
          tone={s.musicOutstanding > 0 ? "warn" : undefined}
        />
      </div>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
          <span>More</span>
          {/* Inline, because no icon dependency is worth one chevron. */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-gray-400"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>

        <div className="space-y-4 border-t border-gray-100 px-4 py-4 text-sm">
          <section>
            <SectionTitle>The show</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="Dancers" value={String(s.dancers)} />
              <Row label="Declared runtime" value={mmss(s.declaredRuntimeSeconds)} />
              <Row
                label={`Changeover (${Math.max(0, s.entries - 1)} × ${s.changeoverPerActSeconds}s)`}
                value={mmss(s.changeoverSeconds)}
              />
              <Row label="Show estimate" value={hm(s.showEstimateSeconds)} />
              {s.slotSeconds !== null && (
                <Row label="Booked slot" value={hm(s.slotSeconds)} />
              )}
              <Row label="No declared length" value={String(s.entriesMissingDuration)} />
            </dl>
            <p className="mt-2 text-xs text-gray-500">
              Changeover is an assumption — {s.changeoverPerActSeconds} seconds
              between acts. Nothing records the real gap.
              {s.entriesMissingDuration > 0 && (
                <>
                  {" "}
                  {s.entriesMissingDuration} entr
                  {s.entriesMissingDuration === 1 ? "y has" : "ies have"} no
                  declared length, so the estimate is short by however long they
                  run.
                </>
              )}
            </p>
          </section>

          <section>
            <SectionTitle>Music</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {MUSIC_STATES.map((state) => (
                <Row
                  key={state}
                  label={MUSIC_FILTER_LABEL[state]}
                  value={String(s.music[state])}
                />
              ))}
            </dl>
          </section>

          {s.ageBands.length > 0 && (
            <section>
              <SectionTitle>Age bands</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {s.ageBands.map((b) => (
                  <Row
                    key={b.band}
                    label={b.band}
                    value={`${b.entries} · ${b.dancers} dancers`}
                  />
                ))}
              </dl>
            </section>
          )}

          <section>
            <SectionTitle>Props and stage prep</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="Uses props" value={threeState(s.props)} />
              <Row label="Needs stage setup" value={threeState(s.stagePrep)} />
            </dl>
            {(s.props.unanswered > 0 || s.stagePrep.unanswered > 0) && (
              <p className="mt-2 text-xs text-gray-500">
                Unanswered is counted separately and never folded into “no” — the
                question is optional on the entry form, so a blank means nobody
                asked, not that the group said no.
              </p>
            )}
          </section>

          <section>
            <SectionTitle>Money</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="Entry fees collected" value={money(s.entryFeeCents)} />
            </dl>
            <p className="mt-2 text-xs text-gray-500">
              Entry fee lines only — donations and door admission on the same
              event are counted in reconciliation, not here.
            </p>
          </section>
        </div>
      </details>
    </div>
  );
}

/** "4 yes · 1 no · 7 unanswered" — all three, always, even at zero. */
function threeState(t: ThreeState): string {
  return `${t.yes} yes · ${t.no} no · ${t.unanswered} unanswered`;
}

function Headline({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tone === "warn" ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <div
        className={`text-xl font-bold tabular-nums ${
          tone === "warn" ? "text-amber-800" : "text-brand"
        }`}
      >
        {value}
      </div>
      <div className="text-xs leading-tight text-gray-500">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </h3>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-gray-900">{value}</dd>
    </>
  );
}
