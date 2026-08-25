import Image from "next/image";
import Link from "next/link";
import { formatWhen, formatVenueMonthDay } from "@/lib/eventTime";
import { eventSlug } from "@/lib/seo";
import { eventActions, TYPE_LABEL, type ActionableEvent } from "@/lib/eventActions";
import type { EventOfferingKinds } from "@/server/performance";
import type { EventSale } from "@/server/eventSales";

/**
 * One event, as a poster card on the public rail.
 *
 * Exactly ONE button. The old hero carried up to four equally-weighted links,
 * which is not a choice a person makes standing at a bus stop — volunteer and
 * vendor now live in one grouped section below the rail, where they keep their
 * ?event= and do not compete with the sale.
 */

export type PosterEvent = ActionableEvent & {
  status: string;
  name: string;
  /** Half of the event's public slug — see eventSlug(). */
  code: string;
  startsAt: Date;
  endsAt: Date;
  imageUrl: string | null;
  location: string | null;
  honorsMembership: boolean;
};

export function EventPosterCard({
  event: e,
  kinds,
  sale,
  priority,
}: {
  event: PosterEvent;
  kinds?: EventOfferingKinds;
  sale?: EventSale;
  priority: boolean;
}) {
  const primary = eventActions(e, kinds)[0];

  // A price is only honest when there is a door to pay it at. DIW-2026 sits in
  // the database right now with offersRegistration false and a live, capped $30
  // competition offering — the exact state seed-events.ts calls "a scheduled
  // outage" — and its only remaining action is Volunteer. Printing "$30 a group"
  // above a card whose one button is Volunteer states a price nobody can pay.
  // The offering is still misconfigured and still needs fixing in the admin UI;
  // the front door just refuses to advertise it in the meantime.
  const sellable = primary?.key === "register" || primary?.key === "perform";

  return (
    <li
      className="flex shrink-0 grow-0 basis-[214px] snap-start flex-col overflow-hidden
                 rounded-xl border border-gray-200 bg-white sm:basis-auto"
    >
      {/* Poster. aspect-[3/4] = 0.75, the middle of the range DCICA actually
          ships (Dandiya 643x803 = 0.80, Diwali 643x922 = 0.70), so object-cover
          trims a sliver off one edge. The frame this replaces was aspect-[16/9],
          which discarded ~60% of a portrait poster's height — and what it
          discarded was the title, date and price, because these flyers bake
          those into the artwork. */}
      {/* The poster is the link to this event's own page, and it is the only
          link on the card besides the CTA.
          WHY the poster and not the title: /e/<slug> has to be reachable by a
          crawler for it to be indexed at all, and the sitemap alone is a weak
          way to say so — an internal link is the strong one. The title would be
          the obvious anchor, but a 16px line of text is a ~20px tap target and
          this codebase's floor is 48px. The poster is 214x285. It is also what
          a person actually aims at.
          `block` because an <a> is inline by default and would collapse the
          aspect ratio. */}
      <Link
        href={`/e/${eventSlug(e)}`}
        aria-label={`${e.name} — event details`}
        className="relative block aspect-[3/4] bg-gray-100"
      >
        {e.imageUrl ? (
          <Image
            src={e.imageUrl}
            alt={e.name}
            fill
            sizes="(min-width: 640px) 50vw, 214px"
            className="object-cover"
            priority={priority}
          />
        ) : (
          // NEVER another event's artwork, and never an empty box. Dandiya
          // Night's imageUrl is null on purpose: borrowing Rhythm of Navratri's
          // poster put "Entry Fee: $30 Per Group" directly above a card saying
          // entry is $10 per person, and printed the same image twice in a row.
          // People read the picture before the text.
          <div className="flex h-full items-center justify-center bg-brand p-3">
            <span className="text-center text-lg font-bold leading-tight text-brand-fg">
              {e.name}
            </span>
          </div>
        )}
        <span className="absolute bottom-2 left-2 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-brand-fg">
          {formatVenueMonthDay(e.startsAt)}
        </span>
      </Link>

      {/* Saffron title panel — mirrors dcica.org's events design. */}
      <div className="bg-accent px-3 py-2.5 text-accent-fg">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold uppercase tracking-wide opacity-80">
            {TYPE_LABEL[e.type] ?? "Event"}
          </span>
          {e.status === "ACTIVE" && (
            <span className="shrink-0 rounded-full bg-accent2 px-2 py-0.5 text-xs font-semibold text-accent2-fg">
              Now
            </span>
          )}
        </div>
        <h3 className="mt-1 text-base font-bold leading-tight">{e.name}</h3>
        <p className="mt-0.5 text-xs font-medium">
          {formatWhen(e.startsAt, e.endsAt)}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {e.location && (
          <p className="line-clamp-2 text-xs leading-snug text-gray-600">
            {e.location}
          </p>
        )}

        {sale?.sameEveningAs && (
          // Two cards, one night, one gym. Without this the pair reads as a
          // duplicate listing rather than two things sold to two audiences.
          <p className="text-xs leading-snug text-gray-500">
            Same evening as {sale.sameEveningAs.name}
            {sale.sameEveningAs.openFloor ? " \u00b7 open floor" : ""}
          </p>
        )}

        {/* The point of the redesign. Resolved through the same function that
            charges, never from ServiceCap.priceCents. */}
        {sellable && sale?.priceLine && (
          <p className="text-sm font-semibold leading-snug text-gray-900">
            {sale.priceLine}
          </p>
        )}

        {/* Urgency in WEIGHT, not colour. Green/amber/red is status vocabulary a
            volunteer reads at a door under time pressure; minting a second,
            public status palette here would put a brand-adjacent colour on a
            safety signal, which is exactly what verify-branding §8 exists to
            stop. */}
        {sellable && sale?.capacityLine && (
          <p className="text-xs font-semibold leading-snug text-gray-700">
            {sale.capacityLine}
          </p>
        )}

        {e.honorsMembership && (
          <p className="text-xs leading-snug text-gray-600">Members get in free</p>
        )}

        {primary && (
          <Link
            href={primary.href}
            className="mt-auto flex min-h-tap items-center justify-center rounded-lg bg-brand px-3 text-center text-sm font-semibold text-brand-fg"
          >
            {primary.label}
          </Link>
        )}
      </div>
    </li>
  );
}
