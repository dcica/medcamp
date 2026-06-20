import QRCode from "qrcode";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PageHelp } from "@/app/_components/PageHelp";
import { SimulatePayButton } from "./SimulatePayButton";

export const dynamic = "force-dynamic";

/**
 * Registration confirmation + QR badges (Module 1 tail; feeds Module 2 check-in).
 * A confirmed order shows one QR badge per attendee, encoding the campId that
 * the check-in scanner reads. A pending order shows an awaiting-payment state.
 */
export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      event: true,
      attendees: {
        include: {
          lineItems: { include: { serviceType: true } },
        },
      },
    },
  });

  if (!order) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Order not found</h1>
      </main>
    );
  }

  const isConfirmed = order.status === "CONFIRMED";
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
        title={isConfirmed ? "You're registered!" : "Almost there"}
        subtitle={order.event.name}
        items={[
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
        ]}
      />

      {!isConfirmed && (
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
          <p className="text-center text-xs text-gray-400">
            Bring this QR (printed or on your phone) to check-in.
          </p>
        </div>
      )}
    </main>
  );
}
