import Link from "next/link";
import { eventActions, type ActionableEvent } from "@/lib/eventActions";
import type { EventOfferingKinds } from "@/server/performance";

/**
 * Every way to take part that is not the card's one button.
 *
 * Grouped BY EVENT rather than rendered as a single row of links, because the
 * links are per-event: three of the four seeded events offer volunteering, so
 * one bare /volunteer link would have to drop its ?event= and lose the thing a
 * visitor just tapped through. Grouping also covers the second sale door for an
 * event that sells both a competition entry and floor admission.
 *
 * Server-rendered on purpose. A per-card <details> disclosure was the other
 * option; expanding one changes its height mid-rail and shifts its neighbours'
 * snap alignment, and it needs a 48px summary inside an already 214px card.
 */
export function EventExtras({
  events,
  kinds,
}: {
  events: (ActionableEvent & { name: string })[];
  kinds: Map<string, EventOfferingKinds>;
}) {
  const groups = events
    .map((e) => ({ event: e, extra: eventActions(e, kinds.get(e.id)).slice(1) }))
    .filter((g) => g.extra.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="mt-6 border-t border-gray-200 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        More ways to take part
      </h2>
      <div className="mt-3 space-y-4">
        {groups.map(({ event, extra }) => (
          <div key={event.id}>
            <h3 className="text-sm font-semibold text-gray-800">{event.name}</h3>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {extra.map((a) => (
                <Link
                  key={a.key}
                  href={a.href}
                  className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
