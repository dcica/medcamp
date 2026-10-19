import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/tenant";
import { findPublicOrder } from "@/server/public";
import { confirmFromCheckoutSession } from "@/server/payments";
import { receiptLines } from "@/lib/fees";
import { formatCents } from "@/lib/money";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = PRIVATE_PAGE_METADATA;

/**
 * Where Stripe sends a donor back. Like /confirm, the synchronous re-verify
 * here is cosmetic — the webhook is what confirms and sends the receipt — so
 * a donor who lands before the webhook sees "almost there" rather than a
 * false thank-you.
 */
export default async function DonateThanksPage({
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

  const include = { lineItems: true } as const;
  let order = await findPublicOrder(org.id, orderId, { include });
  if (order && order.status !== "CONFIRMED" && session_id) {
    if (await confirmFromCheckoutSession(order.id, session_id)) {
      order = await findPublicOrder(org.id, orderId, { include });
    }
  }
  if (!order || order.eventId !== null) notFound();

  const confirmed = order.status === "CONFIRMED";
  const giftCents = receiptLines(order.lineItems).reduce((s, li) => s + li.amountCents * li.quantity, 0);

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-10">
      <h1 className="text-xl font-bold">{confirmed ? "Thank you!" : "Almost there"}</h1>
      {confirmed ? (
        <>
          <p className="mt-2 text-sm text-gray-700">
            Your gift of <strong>{formatCents(giftCents)}</strong> to {org.name} is received.
            {order.honoreeName ? ` In honour of ${order.honoreeName}.` : ""}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            A receipt is on its way to {order.registrantEmail}. Please keep it for your records.
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Payment hasn&apos;t been confirmed yet. Once it clears, your receipt is emailed to{" "}
            {order.registrantEmail} and this page will say so.
          </p>
        </div>
      )}
      <Link href="/" className="mt-6 inline-flex min-h-tap items-center text-sm text-brand underline">
        Back to {org.name}
      </Link>
    </main>
  );
}
