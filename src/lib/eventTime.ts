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

/**
 * An event's when-line: one day plus a time range, or a date range if it really
 * spans days.
 *
 * Lives here rather than in a page because `/` and `/events` held a
 * byte-identical copy each. That duplication has already produced two separate
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
  return startDay === endDay
    ? `${startDay} · ${VENUE_TIME.format(start)} – ${VENUE_TIME.format(end)}`
    : `${startDay} – ${endDay}`;
}
