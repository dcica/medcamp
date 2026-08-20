import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/contact";

/**
 * The "nothing on the calendar" state shared by the two public event surfaces
 * (`/` and `/events`). Extracted rather than copied: the identical copy block
 * living in both files twice already let a claim rot in one file and not the
 * other, and the site should say one thing about an empty calendar.
 *
 * The copy names Diwali and Holi and their rough seasons so a visitor learns
 * *when* to come back — editorial fact about a recurring calendar. It never
 * names a date, because no row in the database backs one up.
 *
 * There is deliberately no notify-me signup. No subscriber model, no consent
 * record and no SMS sender exist anywhere in this codebase, so the handoff's
 * "text me when registration opens · one message per event" would be a promise
 * about a system nobody has built — and phone-number consent is a larger
 * obligation than email, not a smaller one. What exists is a mailbox a person
 * reads, so that is what the page offers and what it says out loud.
 */

// Literally the same mailbox as SiteFooter's Contact link, now from the same
// constant rather than a matching literal. There is no /contact route, and no
// public membership route either (only /admin/membership, behind staff auth), so
// the membership ask goes to a human here instead of a 404.
const NOTIFY_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Let me know when registration opens",
)}`;
const MEMBERSHIP_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Becoming a DCICA member",
)}`;

/**
 * @param pastEventsHref anchor to the past-events section, passed only by a page
 *   that actually renders one and only when it has something in it. Omitted on
 *   the landing page, which must never lead with finished events.
 */
export function EmptyEventsState({
  pastEventsHref,
}: {
  pastEventsHref?: string;
}) {
  return (
    // Rounded to match the local idiom of both pages, not the design system's
    // border-radius: 0 — a single square box among rounded cards reads as a bug.
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold leading-tight text-brand">
        Nothing on the calendar just yet
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        The committee is planning the next season. Diwali usually falls in early
        November and Holi in March, and registration opens about six weeks ahead
        of an event — so that is the moment to look again.
      </p>

      <a
        href={NOTIFY_HREF}
        className="mt-4 flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-center text-sm font-semibold text-brand-fg"
      >
        Email us to hear about the next one
      </a>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        This opens an email to the committee — a volunteer reads it and writes
        back. We do not send automatic alerts.
      </p>

      {pastEventsHref && (
        <a
          href={pastEventsHref}
          className="mt-2 flex min-h-tap items-center text-sm font-medium text-brand underline"
        >
          Look back at past events
        </a>
      )}

      <div className="mt-5 border-t border-gray-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Meanwhile
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <a
            href={MEMBERSHIP_HREF}
            className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
          >
            Ask about membership
          </a>
          <Link
            href="/volunteer"
            className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
          >
            Volunteer with us
          </Link>
        </div>
      </div>
    </section>
  );
}
