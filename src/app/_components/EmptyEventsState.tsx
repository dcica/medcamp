import Link from "next/link";

/**
 * The "nothing on the calendar" state for the public event surface (`/`).
 * Extracted rather than inlined: the identical copy block once lived in two
 * pages at once, which let a claim rot in one file and not the other, and the
 * site should say one thing about an empty calendar.
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
 *
 * The primary action is "Contact us" rather than "Email us to hear about the
 * next one" on purpose. The narrower label only invited one kind of message,
 * and the committee would rather a visitor write in for any reason — asking
 * about a venue, a vendor stall, a class — because every one of those arrives
 * with a return address the committee can keep. A general invitation collects
 * more of them than a mailing-list ask.
 */

// Literally the same mailbox as SiteFooter's Contact link, now from the same
// constant rather than a matching literal. There is no /contact route, and no
// public membership route either (only /admin/membership, behind staff auth), so
// the membership ask goes to a human here instead of a 404.
function mailto(contactEmail: string, subject: string): string {
  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`;
}

export function EmptyEventsState({
  orgName,
  contactEmail,
  donateHref = null,
}: {
  orgName: string;
  /** From the organisation's profile; null hides the two email asks. */
  contactEmail: string | null;
  /** The donate page, when the organisation has opened it; null hides the ask. */
  donateHref?: string | null;
}) {
  const CONTACT_HREF = contactEmail ? mailto(contactEmail, `Contact ${orgName}`) : null;
  const MEMBERSHIP_HREF = contactEmail ? mailto(contactEmail, `Becoming a ${orgName} member`) : null;
  return (
    // Rounded to match the local idiom of the page, not the design system's
    // border-radius: 0 — a single square box among rounded cards reads as a bug.
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold leading-tight text-brand">
        Nothing on the calendar just yet
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        The organisers are planning the next season. Registration usually opens
        a few weeks ahead of an event — so that is the moment to look again.
      </p>

      {CONTACT_HREF && (
        <>
          <a
            href={CONTACT_HREF}
            className="mt-4 flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-center text-sm font-semibold text-brand-fg"
          >
            Contact us
          </a>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            This opens an email to the organisers — a volunteer reads it and
            writes back. There are no automatic alerts, so tell us what you are
            interested in and someone can let you know once it is scheduled.
          </p>
        </>
      )}

      <div className="mt-5 border-t border-gray-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Meanwhile
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {donateHref && (
            <Link
              href={donateHref}
              className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
            >
              Make a gift to {orgName}
            </Link>
          )}
          {MEMBERSHIP_HREF && (
            <a
              href={MEMBERSHIP_HREF}
              className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
            >
              Ask about membership
            </a>
          )}
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
