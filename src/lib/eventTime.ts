/**
 * The timezone every event time is rendered in.
 *
 * WHY pin one at all: `Intl` with no `timeZone` falls back to whatever zone the
 * *process* happens to be in. That made the same stored instant render three
 * different ways — a Garba class stored at 2026-09-19T20:00Z showed 3:00 PM on a
 * Chicago box, 4:00 PM on the America/New_York dev box, and 8:00 PM on Vercel,
 * which runs UTC. The printed flyer says 3:00 PM. Server components rendered in
 * the server's zone and client components in the visitor's device zone, so two
 * pages of this app could state two different times for one event to one person.
 *
 * WHY the venue's zone and not the visitor's: a flyer and a door both state
 * venue time. A volunteer who travels, or a coordinator on a laptop in another
 * state, must read the same clock as the event they are working — showing them
 * their own zone would be a time that does not match the door.
 *
 * WHY an IANA name and never a fixed offset: `-05:00` is wrong for half the year
 * and would break silently at each DST boundary. `America/Chicago` carries the
 * rules.
 *
 * WHY a constant and not per-tenant config: it belongs in `Organization`
 * settings, per the configuration-over-code mandate — a second tenant must not
 * edit source to hold events in its own zone. That is a separate task, and it is
 * not free: every call site would need the org threaded in, and the client
 * components here have no access to it. Same reasoning, same shape, as
 * CONTACT_EMAIL in `src/lib/contact.ts`. One constant, many importers, until a
 * second tenant makes the setting worth building.
 */
export const VENUE_TIME_ZONE = "America/Chicago";

// Hoisted, not rebuilt per call: `Intl.DateTimeFormat` construction is the
// expensive part and these are stateless once built.
const VENUE_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: VENUE_TIME_ZONE,
});

const VENUE_TIME = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
  timeZone: VENUE_TIME_ZONE,
});

const VENUE_MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: VENUE_TIME_ZONE,
});

/**
 * Month and day for one instant, in the venue's zone — the poster date pill on
 * the public rail, and the "through Sep 15" in an early-bird price line.
 *
 * A named function for the same reason `formatVenueTime` is one: this is the
 * SHORT form, with no year and no time, so a reader has nothing to cross-check
 * it against. An inline `toLocaleDateString({month,day})` reads the process
 * zone, and Vercel runs UTC — a 7 PM Oct 10 event would print "Oct 11" on the
 * pill and "Oct 10" in the when-line two lines below it, on the same card.
 */
export function formatVenueMonthDay(instant: Date): string {
  return VENUE_MONTH_DAY.format(instant);
}

/**
 * Clock time for one instant, in the venue's zone.
 *
 * The gate prints this beside "already admitted ✓" — the volunteer reading it is
 * standing at the door and will compare it against the clock on the wall, so it
 * must be venue time and never the device's. Locale is left to the reader's
 * device (that is only digits and AM/PM); the ZONE is not negotiable, which is
 * the whole reason this is a named function rather than an inline
 * `toLocaleTimeString` a redesign can drop the options off.
 */
export function formatVenueTime(instant: Date): string {
  return instant.toLocaleTimeString(undefined, { timeZone: VENUE_TIME_ZONE });
}

/**
 * An event's when-line: one day plus a time range, or a date range if it really
 * spans days.
 *
 * Lives here rather than in a page because `/` and the since-removed `/events`
 * held a byte-identical copy each. That duplication produced two separate
 * defects on this branch (C1 and C3), and the timezone bug above was a third —
 * present twice, fixable only twice.
 *
 * The same-day test compares the formatted *venue* day, not `toDateString()`,
 * which reads the process zone. That mattered: an evening event running
 * 21:30Z–04:00Z is one Texas evening (4:30–11:00 PM) but two UTC days, so the
 * old test said "multi-day" on Vercel and printed a bare date range for a
 * single-evening event. Comparing the string we are about to print keeps the
 * day and the times from ever coming from two different zones.
 */
export function formatWhen(start: Date, end: Date): string {
  const startDay = VENUE_DATE.format(start);
  const endDay = VENUE_DATE.format(end);
  const oneEvening = startDay === endDay || spillsIntoTheSmallHours(start, end);
  return oneEvening
    ? `${startDay} · ${VENUE_TIME.format(start)} – ${VENUE_TIME.format(end)}`
    : `${startDay} – ${endDay}`;
}

/**
 * An event ending at or before this venue hour on the FOLLOWING venue day is
 * still one evening, not a two-day event.
 *
 * Dandiya Night runs 7:00 PM to midnight. Midnight is the next venue day, so
 * the same-day test above failed and the public card printed a bare
 * "Oct 10, 2026 – Oct 11, 2026" — a card advertising a dance floor with no door
 * time on it at all, which is the one fact a person reads it for. The zone fix
 * documented above solved the *wrong day*; it did not solve the *missing time*,
 * because 7 PM to midnight really is two venue days.
 *
 * 4 AM is late enough to cover any evening event that runs over, and early
 * enough that no genuine multi-day event qualifies.
 */
const EVENING_SPILL_END_HOUR = 4;

/**
 * True when `end` lands in the small hours of the venue day right after `start`.
 *
 * `venueDaysUntil` rather than a millisecond difference, for the reason its own
 * doc comment gives: it counts VENUE CALENDAR days, so it does not slip by one
 * at a DST boundary. Requiring exactly 1 is what keeps a three-day festival out
 * of this branch.
 *
 * Known, accepted edge: an 18-hour event running 9 AM to 3 AM the next day now
 * prints as one evening. That reads correctly ("9:00 AM – 3:00 AM") and no such
 * event exists in the domain; the alternative is a lower-bound hour test that
 * would fail the 5 PM competition this was written for.
 */
function spillsIntoTheSmallHours(start: Date, end: Date): boolean {
  if (venueDaysUntil(end, start) !== 1) return false;
  return venueWallClock(end).hour < EVENING_SPILL_END_HOUR;
}

/* ------------------------------------------------------------------------- *
 * `<input type="datetime-local">` ⇄ stored instant
 *
 * WHY these exist at all — do not replace either with `new Date(value)`:
 * a `datetime-local` input submits a bare wall-clock string, `"2026-09-19T15:00"`,
 * with NO zone in it. `new Date()` on that string parses it in the *process*
 * zone, and Vercel runs UTC. So a coordinator typing the flyer's 3:00 PM stored
 * `15:00Z`, which is 10:00 AM in Flower Mound — a five-hour error. That is the
 * defect that put `2:00 AM – 8:00 AM` on a live medical camp. `formatWhen` above
 * pinned the *display* side to the venue zone; these two pin the *write* side, so
 * the number the coordinator types is the number on the door.
 *
 * WHY the offset is derived at the converted instant and never written as a
 * constant: December in Flower Mound is CST (UTC−6) and June is CDT (UTC−5). A
 * hardcoded `-06:00` is wrong for half the year and would break silently at each
 * DST boundary — the same reason `VENUE_TIME_ZONE` is an IANA name.
 * ------------------------------------------------------------------------- */

// Whole-part read-out of an instant *in the venue zone*. `hourCycle: "h23"`
// matters: the default `h12` yields hour "24" for midnight, which is not a legal
// `datetime-local` value and would break the arithmetic below.
const VENUE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: VENUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function venueWallClock(instant: Date): WallClock {
  const p: Record<string, string> = {};
  for (const { type, value } of VENUE_PARTS.formatToParts(instant)) {
    p[type] = value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/**
 * The venue zone's offset from UTC, in ms, *at a given instant* — positive west
 * of Greenwich (CST = 21_600_000).
 *
 * Reading the instant's venue wall clock and re-interpreting those same digits
 * as UTC gives an instant that is exactly one offset away from the real one.
 * `Intl` supplies the DST rules, so this is correct on both sides of every
 * transition without a table or a date library.
 */
function venueOffsetMs(instant: number): number {
  const w = venueWallClock(new Date(instant));
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - instant;
}

/**
 * Stored instant → the `YYYY-MM-DDTHH:mm` string a `datetime-local` input wants,
 * in venue wall-clock time. Round-trips with `venueInputToInstant` below.
 */
export function instantToVenueInput(instant: Date): string {
  if (isNaN(+instant)) return "";
  const w = venueWallClock(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * A `datetime-local` value read as venue wall-clock time → the UTC instant to
 * store. `null` when the string is not a usable date-time (the caller turns that
 * into readable copy rather than storing `Invalid Date`).
 *
 * Two passes: the first offset is sampled at the naive UTC reading of the digits,
 * which lands within a day of the answer and so gives the right DST rule almost
 * always; the second samples at that candidate, which fixes the few hours either
 * side of a transition where the first guess sits on the wrong side of the
 * boundary. It converges — a third pass never changes the result.
 *
 * Spring-forward gap (2:30 AM on 2027-03-14 does not exist in Flower Mound): the
 * result is the real instant one hour later. That is the same thing the browser's
 * own picker does and it is a legal time; refusing it would block a coordinator
 * over an hour nobody schedules an event in.
 */
export function venueInputToInstant(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ];
  // Reject 2026-13-40T25:99 — the regex only proves shape, not that the date is
  // real. Date.UTC rolls overflow silently, so compare it back.
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(naive);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    back.getUTCHours() !== hour ||
    back.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const firstPass = naive - venueOffsetMs(naive);
  return new Date(naive - venueOffsetMs(firstPass));
}

/**
 * Whole days from `now` until `target`, counted in **venue calendar days**.
 *
 * "Camp day is in 12 days" is a statement about the calendar a coordinator is
 * looking at, not about elapsed milliseconds. Dividing a millisecond difference
 * by 86,400,000 — which is what getTrackedEvents does for its coarser
 * `daysUntil` — answers a different question: an event starting at 9am tomorrow
 * is "0 days" at 11pm tonight and "1 day" at 8am tomorrow, and it slips by one
 * across every DST boundary in between. Both sides are reduced to their venue
 * calendar date first, so the answer changes exactly once per venue midnight and
 * never at a DST transition.
 *
 * Negative once the target is in the past; 0 means "today, at the venue".
 */
export function venueDaysUntil(target: Date, now: Date = new Date()): number {
  const day = (d: Date) => Date.parse(`${instantToVenueInput(d).slice(0, 10)}T00:00:00Z`);
  return Math.round((day(target) - day(now)) / 86_400_000);
}
