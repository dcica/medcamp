import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { formatWhen } from "@/lib/eventTime";
import { STATUS_STYLE } from "@/lib/eventLifecycle";
import {
  getEventReadiness,
  whenPhrase,
  type EventReadiness,
  type ReadinessItem,
} from "@/server/events";
import { destinationsFor } from "@/app/_components/staffNav";
import { LifecycleRail } from "@/app/_components/LifecycleRail";

export const dynamic = "force-dynamic";

/**
 * Admin overview — design frame 1B.
 *
 * WHAT THIS REPLACES. Two stat cards ("3 camps", "14 members"), a list of camps
 * whose status line was `0 services · 0 stations · 0 registered` in 12px grey,
 * and a `PageHelp` toggle holding three tips in localStorage. Between them they
 * answered "how many things exist" and never "what needs doing", which is the
 * only question a coordinator opens this screen with. Measured on the dev
 * database, DCICA Festival of Lights — publicly OPEN, nothing priced, so a guest
 * who taps Register reaches an empty form — rendered its "0 services" in exactly
 * the same weight as the "4 services" on the event above it.
 *
 * THE HELP PANEL IS GONE AND ITS THREE TIPS ARE PRINTED WHERE THEY APPLY:
 *   - "status colors / a camp moves DRAFT → OPEN → ACTIVE → CLOSED → PURGED"
 *     is the lifecycle rail plus the sentence under it, which says what THIS
 *     event's state means rather than reciting the whole machine.
 *   - "each card shows a camp's counts, tap one to configure it" is the line
 *     under Other events, next to the rows it describes.
 *   - "the member count is everyone with a role in this organization" is the
 *     Members cell's own subtitle in Where things live.
 * A tip stored behind a toggle is a tip nobody reads twice.
 *
 * THERE IS NO NAV HERE. The six-tab strip that used to sit in the admin shell
 * clipped 345px of itself off a 375px phone; it was consolidated into the
 * hamburger (src/app/_components/staffNav.ts). "Where things live" is an index
 * with counts, not a second navigation — and it filters through
 * `destinationsFor` so a COMMITTEE_ADMIN is never offered the four
 * coordinator-only screens that would 403 them.
 */
export default async function AdminOverview() {
  const member = await requireAdmin();
  const org = await getActiveOrg();

  const [events, memberCount, planCount, volunteerCount] = await Promise.all([
    org ? getEventReadiness(org.id) : Promise.resolve([]),
    org ? db.membership.count({ where: { orgId: org.id } }) : Promise.resolve(0),
    org
      ? db.membershipPlan.count({ where: { orgId: org.id } })
      : Promise.resolve(0),
    org ? db.volunteer.count({ where: { orgId: org.id } }) : Promise.resolve(0),
  ]);

  // Soonest first, finished events last — getEventReadiness sorts. The head of
  // that list IS "next up"; there is no second opinion about which event leads.
  const [next, ...others] = events;

  const reachable = new Set(destinationsFor(member.role).map((d) => d.href));
  const index = [
    { href: "/admin/camps", name: "Camps & events", detail: `${events.length} · create, dates, status` },
    { href: "/admin/members", name: "Members", detail: `${memberCount} · everyone with a role here` },
    { href: "/admin/membership", name: "Membership", detail: `${planCount} plans · family comps` },
    { href: "/admin/email", name: "Email", detail: "sender & test send" },
    { href: "/admin/settings", name: "Settings", detail: "org, brand, timezone" },
    { href: "/volunteers", name: "Volunteers", detail: `${volunteerCount} · roster, sign-in, certs` },
  ].filter((d) => reachable.has(d.href));

  return (
    <div className="mt-6 space-y-8">
      {next ? (
        <NextUp event={next} />
      ) : (
        <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
          No events yet.{" "}
          <Link href="/admin/camps" className="text-brand underline">
            Create one
          </Link>
          .
        </p>
      )}

      {others.length > 0 && (
        <section>
          <Kicker>Other events</Kicker>
          <p className="mb-2 text-xs text-gray-500">
            Tap an event for its setup, counts and lifecycle.
          </p>
          <ul className="space-y-2">
            {others.map((e) => (
              <li key={e.id}>
                <OtherEventRow event={e} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {index.length > 0 && (
        <section>
          <Kicker>Where things live</Kicker>
          <div className="grid grid-cols-2 gap-2">
            {index.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="flex min-h-tap flex-col justify-center rounded-lg border border-gray-200 bg-white px-3 py-2"
              >
                <span className="text-sm font-semibold text-brand">{d.name}</span>
                <span className="text-xs text-gray-600">{d.detail}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Next up ─────────────────────────────────────────────────────────────── */

function NextUp({ event }: { event: EventReadiness }) {
  const blocked = event.blockers > 0;

  return (
    <section>
      <Kicker>Next up</Kicker>
      {/* The largest type on the screen. It used to be the word "Admin". */}
      <h2 className="text-2xl font-bold leading-8 text-brand">{event.name}</h2>
      <p className="mt-1 text-sm text-gray-600">
        {event.code} · {formatWhen(event.startsAt, event.endsAt)}
        {event.location ? ` · ${event.location}` : ""}
      </p>

      <div className="mt-4">
        <LifecycleRail status={event.status} />
      </div>
      {/* Tip 2 from the old help panel, printed against the state it explains. */}
      <p className="mt-2 text-sm text-gray-600">{statusSentence(event)}</p>

      <div
        className={`mt-5 overflow-hidden rounded-xl border ${
          blocked ? "border-red-300" : "border-gray-200"
        }`}
      >
        <div
          className={`flex items-center justify-between gap-3 px-3 py-2 ${
            blocked ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"
          }`}
        >
          <span className="text-sm font-bold uppercase tracking-wide">
            Setup {event.done} of {event.total}
          </span>
          <span className="text-xs font-medium">
            {blocked
              ? `${event.blockers} blocker${event.blockers === 1 ? "" : "s"}`
              : "Nothing outstanding"}
          </span>
        </div>

        <ul className="space-y-2 bg-white p-3">
          {event.items.map((item) => (
            <li key={item.key} className="flex gap-2">
              <StateGlyph done={item.done} />
              <span className="text-sm">
                <span className={item.done ? "" : "font-semibold text-red-700"}>
                  {item.label}
                </span>
                {item.consequence && (
                  <span className="mt-0.5 block text-sm text-gray-600">
                    {item.consequence}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {/*
          ONE action, aimed at the FIRST blocker in flow order. Not one button
          per unmet row: five buttons is five decisions, and four of them are
          usually premature — assigning volunteers to stations that do not exist
          yet is work you do twice. When nothing is outstanding there is no
          footer at all rather than an invented action.
        */}
        {event.firstBlocker && (
          <div className="border-t border-gray-200 bg-white p-3">
            <Link
              href={event.firstBlocker.href}
              className="flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-center text-sm font-semibold text-brand-fg"
            >
              {event.firstBlocker.action} →
            </Link>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Link
          href={`/admin/camps/${event.id}`}
          className="flex min-h-tap flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-center text-sm font-medium text-brand"
        >
          Open camp setup
        </Link>
        <Link
          href="/dashboard"
          className="flex min-h-tap items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-center text-sm font-medium text-brand"
        >
          Live board
        </Link>
      </div>
    </section>
  );
}

/* ── Other events ────────────────────────────────────────────────────────── */

/**
 * One ruled row per event, with a meta line that says the useful thing rather
 * than three counts.
 *
 * THE RED IS RATIONED. Every event on the dev database has at least one unmet
 * row, so tinting anything with a blocker would tint all of them and the tint
 * would stop meaning anything — the same trap as flagging a dandiya night for
 * having no stations. `brokenInPublic` (src/server/events.ts) marks the one
 * class of failure a GUEST is hitting today, and only that gets the treatment.
 * On the dev database exactly one event qualifies: DCICA Festival of Lights,
 * publicly OPEN with nothing priced.
 */
function OtherEventRow({ event }: { event: EventReadiness }) {
  const live = event.items.find((i) => i.brokenInPublic);

  return (
    <Link
      href={`/admin/camps/${event.id}`}
      className={`block min-h-tap rounded-lg border px-3 py-2 ${
        live ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* Two live events are one letter apart ("Dandiya Night" /
            "Dandia Night 2026"), so the name may not truncate and the code
            below is what tells them apart. */}
        <span className="text-sm font-semibold text-brand">{event.name}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[event.status]}`}
        >
          {event.status}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-gray-600">{metaLine(event)}</p>
      {live && (
        <p className="mt-1 flex gap-1.5 text-xs font-semibold text-red-700">
          <StateGlyph done={false} />
          <span>
            {live.label} — {live.action} →
          </span>
        </p>
      )}
    </Link>
  );
}

/** The one line that is worth printing about an event that is not the headline. */
function metaLine(e: EventReadiness): string {
  const setup = `setup ${e.done} of ${e.total}`;
  // "patient data" is a camp's words. A dandiya night sells tickets to adults.
  const held = e.type === "CAMP" ? "patient data" : "attendee data";
  const seen = `${e.registered} registered`;

  switch (e.status) {
    case "DRAFT":
      return `${e.code} · ${setup} · not yet public`;
    case "CLOSED":
      return `${e.code} · ${seen} · ${held} awaiting purge`;
    case "PURGEABLE":
      return `${e.code} · ${seen} · ${held} ready to purge`;
    case "PURGED":
      return `${e.code} · ${seen} · ${held} removed`;
    default:
      // OPEN or ACTIVE. A finished event still in one of those states is
      // selling, or claiming to be running, months after it ended — that is
      // the thing to say about it, not how much setup it has left.
      return e.hasFinished
        ? `${e.code} · ${seen} · ended ${whenPhrase(e.daysUntil)}, still ${e.status}`
        : `${e.code} · ${setup} · ${whenPhrase(e.daysUntil)}`;
  }
}

/** What the current lifecycle state means for this event, in one sentence. */
function statusSentence(e: EventReadiness): string {
  const when = whenPhrase(e.daysUntil);
  switch (e.status) {
    case "DRAFT":
      return `Not public yet. Opening registration puts it on the events page. Starts ${when}.`;
    case "OPEN":
      return e.hasFinished
        ? `Still taking registrations, and it ended ${when}. Close it.`
        : `Taking registrations now. ${e.registered} in, starts ${when}.`;
    case "ACTIVE":
      return e.hasFinished
        ? `Still marked as running, and it ended ${when}. Close it.`
        : `Day-of controls are live. ${e.registered} registered, starts ${when}.`;
    case "CLOSED":
      return `Finished. Attendee records are still held until the event is purged.`;
    case "PURGEABLE":
      return `Finished. Attendee records may now be purged.`;
    case "PURGED":
      return `Finished. Attendee records have been removed.`;
  }
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </p>
  );
}

/**
 * Tick or alert. Inline SVG, following StaffMenu.tsx — the app has no icon
 * library and one glyph is not worth a dependency.
 */
function StateGlyph({ done }: { done: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-0.5 h-4 w-4 shrink-0 ${done ? "text-gray-400" : "text-red-600"}`}
    >
      {done ? (
        <path d="M4 12.5l5.5 5.5L20 6" />
      ) : (
        <>
          <path d="M12 5v9" />
          <path d="M12 18.5v.5" />
        </>
      )}
    </svg>
  );
}
