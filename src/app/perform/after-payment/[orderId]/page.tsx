import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { confirmFromCheckoutSession } from "@/server/payments";
import { CONTACT_EMAIL } from "@/lib/contact";

export const dynamic = "force-dynamic";

/**
 * Where Stripe returns an entrant after paying a competition fee. Confirms the
 * order, then forwards to the song step — the entrant sends us their track
 * BEFORE seeing the confirmation page, because that is the one moment they are
 * definitely still holding their phone and thinking about this entry. Chasing a
 * missing track by email a week later is the job this ordering avoids.
 *
 * The receipt code cannot exist before this point: confirmOrder assigns it, so
 * there is no /perform/<code> URL to send Stripe to when the session is created.
 * Hence this intermediate hop keyed on the order id.
 *
 * A redirect and not a render: nothing here is worth a page of its own, and the
 * entrant should end up on a URL they can bookmark and come back to.
 */
export default async function AfterPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { orderId } = await params;
  const { session_id } = await searchParams;

  // Same race Stripe creates for /confirm — the webhook usually loses it, so
  // confirm synchronously here. Idempotent and atomically claimed, so whichever
  // of the two paths wins, the other is a no-op.
  const confirmed = await confirmFromCheckoutSession(orderId, session_id);

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      attendees: { select: { campId: true }, take: 1 },
      performanceEntry: { select: { id: true } },
    },
  });

  const campId = order?.attendees[0]?.campId;

  // Happy path: hand them the bookmarkable capability URL for their entry.
  if (confirmed && campId && order?.performanceEntry) {
    redirect(`/perform/${campId}?paid=1`);
  }

  // Not confirmed yet — the webhook is the backstop and will land shortly. Don't
  // pretend it failed; give them the confirmation page, which knows how to show
  // a pending order and re-attempts the same confirm on reload.
  if (!order) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Entry not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          We couldn&apos;t find that entry. If you were charged, write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
      </main>
    );
  }

  // A confirmed order with no PerformanceEntry means this order came through
  // /register rather than the entry form — possible for a mixed event that also
  // sells admission. Send it to the ordinary confirmation.
  if (confirmed && !order.performanceEntry) {
    redirect(`/confirm/${orderId}`);
  }

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-10">
      <h1 className="text-xl font-bold">Payment received</h1>
      <p className="mt-2 text-sm text-gray-600">
        We&apos;re still finalising your entry — this usually takes a few
        seconds. Reload this page, or open your confirmation below.
      </p>
      <Link
        href={`/confirm/${orderId}`}
        className="mt-6 flex min-h-tap w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
      >
        Go to my confirmation
      </Link>
    </main>
  );
}
