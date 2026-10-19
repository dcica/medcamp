import { z } from "zod";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { venueDayKey } from "@/lib/eventTime";
import type { OrgDonations } from "@/lib/orgSettings";

/**
 * General-fund donations: the /donate page's order, and the donor list.
 *
 * A donation order sells nothing and admits nobody. It has NO event (the
 * gift is to the organisation), ONE donation line, no attendee rows, and it
 * goes through the same hosted Checkout and the same webhook-authoritative
 * confirmation as a ticket (decision #2). What differs is the email at the
 * end: a receipt, not a ticket. The order carries no phone (the schema's
 * column is kept empty) because a receipt needs an email and nothing else.
 *
 * The buyer-facing wording lives HERE, on plain Errors, the way
 * createRegistration does it: the action passes a message through, it never
 * authors one. The policy (src/lib/orgSettings.ts `donations`) is the
 * organisation's: off by default, a minimum it sets, the cover offered or not.
 */
export const donationSchema = z.object({
  donor: z.object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Valid email required"),
  }),
  amountCents: z.number().int("Enter a whole-dollar amount").min(1, "Enter an amount"),
  /** "Cover the processing cost" — the organisation's gross-up (src/lib/fees.ts), never a tip. */
  coverFee: z.boolean().optional(),
  honoreeName: z.string().trim().max(120, "Keep the honoree's name under 120 characters").optional(),
  donorNote: z.string().trim().max(300, "Keep the note under 300 characters").optional(),
  marketingConsent: z.boolean().optional(),
});
export type DonationInput = z.infer<typeof donationSchema>;

export type CreatedDonation = { orderId: string; totalCents: number };

/**
 * Create the PENDING donation order. The policy is checked FIRST — a closed
 * door is refused before anything about the donor is read — then the input,
 * then the organisation's minimum.
 */
export async function createDonationOrder(
  orgId: string,
  input: DonationInput,
  policy: OrgDonations,
): Promise<CreatedDonation> {
  if (!policy.enabled) throw new Error("Donations are not open right now.");
  const parsed = donationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check your details and try again.");
  }
  const data = parsed.data;
  if (data.amountCents < policy.minCents) {
    throw new Error(`The minimum donation is ${formatCents(policy.minCents)}.`);
  }

  const order = await db.order.create({
    data: {
      orgId,
      eventId: null,
      status: "PENDING",
      method: "STRIPE",
      registrantName: data.donor.name,
      registrantEmail: data.donor.email,
      registrantPhone: "",
      marketingConsent: data.marketingConsent ?? false,
      marketingConsentAt: data.marketingConsent ? new Date() : null,
      coverProcessingFee: (data.coverFee ?? false) && policy.allowFeeCover,
      honoreeName: data.honoreeName || null,
      donorNote: data.donorNote || null,
      lineItems: {
        create: [
          {
            orgId,
            description: "Donation",
            amountCents: data.amountCents,
            quantity: 1,
            isDonation: true,
          },
        ],
      },
    },
    select: { id: true },
  });
  return { orderId: order.id, totalCents: data.amountCents };
}

// ── The donor list ───────────────────────────────────────────────────────────

export const DONORS_REPORT_HEADER = [
  "date",
  "donor",
  "email",
  "amount_usd",
  "event",
  "honoree",
  "order",
] as const;

export type DonorRow = Record<(typeof DONORS_REPORT_HEADER)[number], string>;

/**
 * Every donation RECEIVED in a year — PAID donation lines on CONFIRMED
 * orders, dated by the first succeeded payment on the venue's calendar —
 * whether given on /donate (event "general") or added to a ticket order
 * (the event's code). Money received, never intent: a PENDING gift is not a
 * donor. The organisation's year-end list, and nothing else; no totals are
 * invented here.
 */
export async function getDonorRows(orgId: string, opts: { year: number }): Promise<DonorRow[]> {
  // A day either side of the UTC year, then the venue-calendar year decides.
  const from = new Date(Date.UTC(opts.year, 0, 1) - 86_400_000);
  const to = new Date(Date.UTC(opts.year + 1, 0, 1) + 86_400_000);
  const lines = await db.lineItem.findMany({
    where: {
      orgId,
      isDonation: true,
      status: "PAID",
      order: {
        status: "CONFIRMED",
        payments: { some: { status: "SUCCEEDED", createdAt: { gte: from, lt: to } } },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      amountCents: true,
      quantity: true,
      order: {
        select: {
          id: true,
          registrantName: true,
          registrantEmail: true,
          honoreeName: true,
          event: { select: { code: true } },
          payments: {
            where: { status: "SUCCEEDED" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });

  const rows: DonorRow[] = [];
  for (const li of lines) {
    const paidAt = li.order.payments[0]?.createdAt;
    if (!paidAt) continue;
    const day = venueDayKey(paidAt);
    if (!day.startsWith(`${opts.year}-`)) continue;
    rows.push({
      date: day,
      donor: li.order.registrantName,
      email: li.order.registrantEmail,
      amount_usd: ((li.amountCents * li.quantity) / 100).toFixed(2),
      event: li.order.event?.code ?? "general",
      honoree: li.order.honoreeName ?? "",
      order: li.order.id,
    });
  }
  return rows;
}
