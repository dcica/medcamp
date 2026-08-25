import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { formatCents } from "@/lib/money";
import { VENUE_TIME_ZONE } from "@/lib/eventTime";
import { getEventRegistrations } from "@/server/registrations";

export const dynamic = "force-dynamic";

/**
 * What this event sold, and to whom.
 *
 * THE SCREEN THE "N registered" COUNT NOW OPENS. Before it, the count on
 * /admin/camps/[id] was a dead end in 12px grey — and it was counting raw
 * Attendee rows, so it included carts nobody paid for and, on a quantity-mode
 * event, one row per admitted head. See src/server/registrations.ts for why
 * `campId != null` is the paid marker.
 *
 * IT IS NOT GATED ON THE EVENT RUNNING. /dashboard is (correctly) about what is
 * happening right now and shows nothing the rest of the year; this answers the
 * other question — how is an event that is merely SELLING doing — which the
 * console could not answer at all.
 */
export default async function EventRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const org = await getActiveOrg();
  if (!org) notFound();

  const event = await db.event.findFirst({ where: { id, orgId: org.id } });
  if (!event) notFound();

  const data = await getEventRegistrations(org.id, event.id);
  const otherRevenue = data.donationCents + data.membershipCents;

  return (
    <div className="space-y-6">
      <div>
        {/* inline-flex + min-h-tap, matching the other sub-screens: as a bare
            inline link this back-out is an 18px target on a phone. */}
        <Link
          href={`/admin/camps/${event.id}`}
          className="inline-flex min-h-tap items-center text-sm text-brand underline"
        >
          ← {event.name}
        </Link>
        <h2 className="mt-2 text-lg font-bold">Registrations &amp; sales</h2>
        <p className="text-xs text-gray-500">
          Confirmed payments only. A registration counts once payment is
          confirmed — abandoned carts are listed separately below.
        </p>
      </div>

      {/* ── Money ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">Collected</span>
          <span className="text-2xl font-bold">
            {formatCents(data.collectedCents)}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {data.paidAttendees} registered across {data.paidOrders} paid order
          {data.paidOrders === 1 ? "" : "s"}
        </p>

        <ul className="mt-3 space-y-1 text-sm">
          {data.byMethod.map((m) => (
            <li key={m.method} className="flex justify-between text-gray-600">
              <span>
                {m.method} ({m.count})
              </span>
              <span>{formatCents(m.cents)}</span>
            </li>
          ))}
          {data.byMethod.length === 0 && (
            <li className="text-gray-400">No payments yet.</li>
          )}
        </ul>

        {otherRevenue > 0 && (
          <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
            {data.donationCents > 0 && (
              <li className="flex justify-between text-gray-600">
                <span>of which donations</span>
                <span>{formatCents(data.donationCents)}</span>
              </li>
            )}
            {data.membershipCents > 0 && (
              <li className="flex justify-between text-gray-600">
                <span>of which membership</span>
                <span>{formatCents(data.membershipCents)}</span>
              </li>
            )}
          </ul>
        )}

        {/* The gap between this screen's count and a raw row count, named
            rather than left for someone to rediscover. Amber, not red: an
            abandoned cart is normal retail behaviour, not a fault. */}
        {data.unpaidOrders > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {data.unpaidOrders} cart{data.unpaidOrders === 1 ? "" : "s"} started
            checkout and never paid — {formatCents(data.unpaidCents)} not
            collected. These are not counted above.
          </p>
        )}
      </section>

      {/* ── Per offering ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          What sold
        </h3>
        {data.offerings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
            This event sells nothing yet.{" "}
            <Link
              href={`/admin/camps/${event.id}/services`}
              className="text-brand underline"
            >
              Add a service
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {data.offerings.map((o) => (
              <li
                key={o.name}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{o.name}</span>
                  <span className="shrink-0 text-sm font-semibold">
                    {formatCents(o.revenueCents)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {/* Uncapped prints the bare count: "25 sold of unlimited" is
                      not a sentence, the same call getTrackedEvents makes. */}
                  {o.capacity === null
                    ? `${o.sold} sold`
                    : `${o.sold} of ${o.capacity} sold`}{" "}
                  · {o.kind}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The orders themselves ─────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Paid orders
        </h3>
        {data.orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
            Nobody has paid yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.orders.map((o) => (
              <li
                key={o.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">
                    {o.registrantName}
                  </span>
                  <span className="shrink-0 text-sm font-semibold">
                    {formatCents(o.collectedCents)}
                  </span>
                </div>
                {/* Venue wall clock, like every other date in the console — a
                    coordinator reconciles against the day the desk worked. */}
                <p className="mt-0.5 break-all text-xs text-gray-500">
                  {o.registrantEmail} ·{" "}
                  {o.createdAt.toLocaleString(undefined, {
                    timeZone: VENUE_TIME_ZONE,
                  })}
                  {o.method ? ` · ${o.method}` : ""}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                  {o.items.map((li, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {li.description}
                        {li.quantity > 1 ? ` × ${li.quantity}` : ""}
                      </span>
                      <span className="shrink-0">
                        {formatCents(li.amountCents * li.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
                {o.campIds.length > 0 && (
                  <p className="mt-2 break-all font-mono text-[11px] text-gray-400">
                    {o.campIds.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
