import Link from "next/link";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizeCampId } from "@/lib/campId";
import { formatWhen, formatVenueDate, formatVenueTime } from "@/lib/eventTime";
import { formatCents } from "@/lib/money";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";
// Never a search result: the URL IS the credential.
export const metadata = PRIVATE_PAGE_METADATA;

/**
 * One ticket, on a phone, at a gate.
 *
 * WHY THIS EXISTS. A party of five gets five QR codes stacked in one email and
 * five more stacked on the confirmation page. Held under a scanner that means
 * TWO CODES IN FRAME AT ONCE, and the camera takes whichever it decodes first —
 * so the station latches onto the wrong attendee and the volunteer acts on it.
 * Same order, wrong person, and the right person then reads ALREADY IN later.
 * One code per screen makes that impossible rather than unlikely.
 *
 * WHY IT IS KEYED ON campId AND NOT THE ORDER. /confirm/[orderId] already
 * existed, is already public, and already renders every QR — but an order id is
 * a cuid, which src/lib/checkoutResume.ts documents as "partly a timestamp and
 * a counter, not unguessable the way the 40-bit CSPRNG campId is". Promoting a
 * receipt page into the primary way people CARRY a ticket would have raised
 * what a guessed URL is worth. A campId is unguessable by construction, and
 * keying on it delivers the per-ticket forwardable link this needs anyway: a
 * family of five splits a booking by sending four of these, which is what they
 * already do by hand with screenshots.
 *
 * NO JS. Prev/next are plain links to sibling campIds, so it is a server
 * component that degrades perfectly and can be forwarded, bookmarked or
 * printed. Nothing here depends on the page staying open.
 */
export default async function TicketPage({
  params,
}: {
  params: Promise<{ campId: string }>;
}) {
  const { campId: raw } = await params;
  const campId = normalizeCampId(decodeURIComponent(raw));

  const attendee = await db.attendee.findFirst({
    where: { campId },
    include: {
      event: true,
      order: {
        include: {
          attendees: {
            select: { id: true, campId: true, name: true, checkedInAt: true },
            orderBy: { campId: "asc" },
          },
          lineItems: { include: { serviceType: true } },
        },
      },
    },
  });

  // 404 rather than a "no such ticket" page: this URL is a capability, and a
  // distinguishable response would confirm which ids exist.
  if (!attendee || !attendee.campId) notFound();

  const party = attendee.order.attendees.filter((a) => a.campId);
  const index = party.findIndex((a) => a.id === attendee.id);
  const prev = index > 0 ? party[index - 1] : null;
  const next = index < party.length - 1 ? party[index + 1] : null;

  const paid = attendee.order.status === "CONFIRMED";
  const used = attendee.checkedInAt;
  const qr = await QRCode.toDataURL(attendee.campId, { margin: 1, width: 320 });

  const merch = attendee.order.lineItems.filter(
    (li) => li.serviceType?.kind === "MERCH",
  );

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <h1 className="text-xl font-bold">{attendee.event.name}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {formatWhen(attendee.event.startsAt, attendee.event.endsAt)}
      </p>
      {attendee.event.location && (
        <p className="mt-0.5 text-sm text-gray-600">{attendee.event.location}</p>
      )}

      {party.length > 1 && (
        <p className="mt-4 text-sm font-semibold">
          Ticket {index + 1} of {party.length}
          {attendee.name ? ` · ${attendee.name}` : ""}
        </p>
      )}

      {/* THE ONE THING AN EMAIL CANNOT DO: say whether this ticket has already
          been used. A family arriving separately can see which of their codes
          are spent before they reach the door. */}
      {used ? (
        <p className="mt-3 rounded-lg bg-amber-400 px-4 py-3 font-semibold text-[#16201f]">
          Already used · {formatVenueDate(used)} {formatVenueTime(used)}
        </p>
      ) : !paid ? (
        <p className="mt-3 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">
          Not paid yet — settle at the desk before entry.
        </p>
      ) : (
        <p className="mt-3 rounded-lg bg-green-600 px-4 py-3 font-semibold text-white">
          Valid — show this at the gate
        </p>
      )}

      <div className="mt-4 rounded-xl border border-gray-300 bg-white p-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt={`QR code ${attendee.campId}`}
          className="mx-auto h-64 w-64"
        />
        <p className="mt-3 break-all font-mono text-sm font-bold tracking-wide">
          {attendee.campId}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Read this out if the camera will not scan.
        </p>
      </div>

      {(prev || next) && (
        <nav className="mt-4 flex gap-2">
          {prev?.campId ? (
            <Link
              href={`/t/${encodeURIComponent(prev.campId)}`}
              className="flex min-h-tap flex-1 items-center justify-center rounded-lg border border-gray-300 font-medium"
            >
              ← Previous
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {next?.campId ? (
            <Link
              href={`/t/${encodeURIComponent(next.campId)}`}
              className="flex min-h-tap flex-1 items-center justify-center rounded-lg border border-gray-300 font-medium"
            >
              Next ticket →
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      )}

      {merch.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Collect at the gate
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {merch.map((li) => (
              <li key={li.id}>
                {li.serviceType?.name ?? li.description}
                {li.quantity > 1 ? ` ×${li.quantity}` : ""}
                {li.fulfilledAt ? (
                  <span className="text-gray-500"> · collected</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {party.length > 1 && (
        <div className="mt-6 rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Everyone on this booking
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {party.map((t, i) => (
              <li key={t.id}>
                {t.id === attendee.id ? (
                  <span className="font-semibold">
                    {i + 1}. {t.name ?? "Guest"} (this one)
                  </span>
                ) : (
                  <Link
                    href={`/t/${encodeURIComponent(t.campId!)}`}
                    className="text-brand underline"
                  >
                    {i + 1}. {t.name ?? "Guest"}
                  </Link>
                )}
                {t.checkedInAt && (
                  <span className="text-gray-500"> · used</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Each link above is that person&rsquo;s own ticket — send it to them
            and they can arrive separately.
          </p>
        </div>
      )}

      <p className="mt-6 text-xs text-gray-500">
        Paid {formatCents(
          attendee.order.lineItems.reduce(
            (s, li) => s + li.amountCents * li.quantity,
            0,
          ),
        )}
        {" · "}
        <Link href={`/confirm/${attendee.orderId}`} className="underline">
          full receipt
        </Link>
      </p>
    </main>
  );
}
