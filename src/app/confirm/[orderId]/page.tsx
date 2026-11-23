import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/tenant";
import { findPublicOrder } from "@/server/public";
import QRCode from "qrcode";
import { confirmFromCheckoutSession } from "@/server/payments";
import { PageHelp } from "@/app/_components/PageHelp";
import { SimulatePayButton } from "./SimulatePayButton";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Never a search result. See PRIVATE_PAGE_METADATA for which of the two
// reasons applies to this page.
export const metadata = PRIVATE_PAGE_METADATA;

const orderInclude = {
  event: true,
  // A competition entry changes what this page MEANS: the code is a receipt, not
  // an admission, and there is a music step still outstanding.
  performanceEntry: true,
  attendees: {
    include: {
      lineItems: { include: { serviceType: true } },
    },
  },
  // A bank debit in flight shows as "processing", not "not confirmed yet".
  payments: { select: { status: true } },
} as const;

/**
 * Registration confirmation + QR badges (Module 1 tail; feeds Module 2 check-in).
 * A confirmed order shows one QR badge per attendee, encoding the campId that
 * the check-in scanner reads. A pending order shows an awaiting-payment state.
 */
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { orderId } = await params;
  const { session_id } = await searchParams;
  const org = await getActiveOrg();
  if (!org) notFound();

  let order = await findPublicOrder(org.id, orderId, { include: orderInclude });

  // ── Race fix ──────────────────────────────────────────────────────────────
  // Stripe redirects the browser to this page the instant Checkout succeeds,
  // and the webhook (the authoritative confirmer) is a separate async POST that
  // usually loses that race — leaving the order PENDING here. So if we arrived
  // with a Checkout session id and the order is still pending, verify the
  // session with Stripe and confirm synchronously. confirmOrderPaid is
  // idempotent + atomically claimed, so whichever path wins, the other is a
  // no-op (and only the winner sends the email).
  if (order && order.status !== "CONFIRMED" && session_id) {
    // ONE path verifies the session — the same confirmFromCheckoutSession the
    // /perform/after-payment page uses — and it carries the organisation's
    // Stripe account option. A second copy here is how that option would be
    // forgotten on exactly the page a connected organisation's buyer lands on.
    if (await confirmFromCheckoutSession(order.id, session_id)) {
      order = await findPublicOrder(org.id, orderId, { include: orderInclude });
    }
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Order not found</h1>
      </main>
    );
  }

  const isConfirmed = order.status === "CONFIRMED";
  // Present only for competition/showcase entries. Drives the copy throughout:
  // the previous wording told an entrant to "bring this QR to check-in", which
  // promises floor access a fee-kind service explicitly does not grant.
  const entry = order.performanceEntry;
  const isDev = process.env.NODE_ENV !== "production";

  // Pre-render a QR per confirmed attendee (encodes the campId for scanning).
  const qrByAttendee = new Map<string, string>();
  if (isConfirmed) {
    for (const att of order.attendees) {
      if (att.campId) {
        qrByAttendee.set(
          att.id,
          await QRCode.toDataURL(att.campId, { margin: 1, width: 240 }),
        );
      }
    }
  }

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="confirm"
        title={
          isConfirmed ? (entry ? "You're entered!" : "You're registered!") : "Almost there"
        }
        subtitle={order.event?.name ?? "Donation"}
        items={
          entry
            ? [
                {
                  label: "Your entry code",
                  body: "Quote this code to the organizers. It identifies your group — it is NOT a ticket and does not admit spectators.",
                },
                {
                  label: "Your music",
                  body: "If you still owe us your track, use the entry link below. We'll confirm once we have a playable copy.",
                },
                {
                  label: "Awaiting payment",
                  body: "If payment hasn't cleared yet, your entry is confirmed as soon as it does.",
                },
              ]
            : [
                {
                  label: "Your QR badge",
                  body: "There's one badge per attendee. Bring it printed or on your phone — the check-in desk scans it on camp day.",
                },
                {
                  label: "Service dots",
                  body: "The colored dots are the services you paid for; each maps to a station you'll visit.",
                },
                {
                  label: "Awaiting payment",
                  body: "If payment hasn't cleared yet, your badge appears here (and arrives by email) as soon as it does.",
                },
              ]
        }
      />

      {!isConfirmed && order.payments.some((p) => p.status === "PROCESSING") && (
        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            Your bank payment is processing. A bank debit takes up to four business
            days to clear; your place is held meanwhile, and your tickets are emailed
            (and shown here) the moment it does. There is nothing to show at the door
            until then.
          </p>
        </div>
      )}
      {!isConfirmed && !order.payments.some((p) => p.status === "PROCESSING") && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Payment hasn&apos;t been confirmed yet. Once your payment clears
            you&apos;ll get an email with your QR badge, and this page will show
            it.
          </p>
          {isDev && <SimulatePayButton orderId={order.id} />}
        </div>
      )}

      {isConfirmed && (
        <div className="mt-6 space-y-4">
          {order.attendees.map((att) => (
            <div
              key={att.id}
              className="rounded-xl border border-gray-200 bg-white p-4 text-center"
            >
              <div className="text-lg font-semibold">{att.name}</div>
              <div className="text-sm text-gray-500">{att.campId}</div>
              {qrByAttendee.get(att.id) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrByAttendee.get(att.id)}
                  alt={`QR badge for ${att.campId}`}
                  className="mx-auto mt-3 h-44 w-44"
                />
              )}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {att.lineItems.map((li) => (
                  <span
                    key={li.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: li.serviceType?.colorHex ?? "#888",
                      }}
                    />
                    {li.serviceType?.name ?? li.description}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {entry && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Your entry
              </p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Group</dt>
                  <dd className="font-medium">{entry.groupName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Song</dt>
                  <dd className="font-medium">{entry.songTitle}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Music</dt>
                  <dd className="font-medium">
                    {entry.songReadyAt
                      ? "Confirmed"
                      : entry.songObjectPath
                        ? "Received — being checked"
                        : "Still needed"}
                  </dd>
                </div>
              </dl>
              {/* The entry link is the only route back to the music step, and a
                  confirmation email is where people look for it later. */}
              {order.attendees[0]?.campId && (
                <Link
                  href={`/perform/${order.attendees[0].campId}`}
                  className="mt-3 flex min-h-tap w-full items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700"
                >
                  {entry.songObjectPath || entry.songReadyAt
                    ? "Manage my entry and music"
                    : "Send us my music"}
                </Link>
              )}
            </div>
          )}

          <p className="text-center text-xs text-gray-400">
            {entry
              ? "This code identifies your group. It is a receipt, not a ticket — it does not admit spectators."
              : "Bring this QR (printed or on your phone) to check-in."}
          </p>
        </div>
      )}
    </main>
  );
}
