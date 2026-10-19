"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";
import {
  recordOfflinePayment,
  type OfflineMethod,
  type OfflinePaymentOutcome,
} from "@/server/offlineOrders";
import { sendTicketEmailFor } from "@/server/payments";

/**
 * Record a Zelle / cheque / cash payment for this event and email the ticket.
 * Admin roles only (the same gate as the page), and the event is re-scoped to
 * the active organisation INSIDE recordOfflinePayment, so a guessed event id
 * from another tenant is "not found" rather than minted against.
 */
export async function recordOfflinePaymentAction(input: {
  eventId: string;
  registrant: { name: string; email: string; phone: string };
  items: { serviceKey: string; quantity: number }[];
  method: OfflineMethod;
  amountDollars: string;
  ref: string;
  channel: "online" | "door";
}): Promise<OfflinePaymentOutcome> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, reason: "refused", message: "No active org." };
  const dollars = input.amountDollars.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(dollars)) {
    return { ok: false, reason: "refused", message: "Enter the amount received in dollars (e.g. 50 or 27.50)." };
  }
  const outcome = await recordOfflinePayment(org.id, {
    eventId: input.eventId,
    registrant: input.registrant,
    items: input.items.filter((i) => i.quantity > 0),
    method: input.method,
    amountCents: Math.round(Number(dollars) * 100),
    ref: input.ref,
    channel: input.channel,
  });
  revalidatePath(`/admin/camps/${input.eventId}/registrations`);
  return outcome;
}

/** Send the ticket email again for a confirmed order of this organisation. */
export async function resendTicketEmailAction(
  orderId: string,
): Promise<{ ok: true; delivered: boolean } | { ok: false; error: string }> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const order = await db.order.findFirst({
    where: { id: orderId, orgId: org.id },
    select: { id: true, status: true, eventId: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "CONFIRMED") return { ok: false, error: "Only a confirmed order has a ticket to send." };
  if (!order.eventId) return { ok: false, error: "A donation gets a receipt when it is paid, not a ticket." };
  const { delivered } = await sendTicketEmailFor(order.id);
  return { ok: true, delivered };
}
