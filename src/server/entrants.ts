import { db } from "@/lib/db";

/**
 * The entrants roster for a quantity-mode event that names its heads: one row
 * per player, with the partner(s) sharing the same unit of the same line —
 * the two seats of a doubles entry, the eight of a table. Brackets and
 * seeding stay with the tournament software; this is the list it is fed from.
 *
 * CONFIRMED orders only: a name typed into an abandoned cart is not an
 * entrant. `paid_at` is the first SUCCEEDED payment's time (ISO), empty for a
 * fully comped order.
 */
export const ENTRANTS_REPORT_HEADER = [
  "division",
  "player",
  "partner",
  "order",
  "email",
  "paid_at",
] as const;

export type EntrantRow = Record<(typeof ENTRANTS_REPORT_HEADER)[number], string>;

export async function getEntrantRows(orgId: string, eventId: string): Promise<EntrantRow[]> {
  const orders = await db.order.findMany({
    where: { orgId, eventId, status: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      registrantEmail: true,
      payments: {
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
      attendees: {
        where: { lineItemId: { not: null } },
        orderBy: { seat: "asc" },
        select: {
          name: true,
          seat: true,
          lineItemId: true,
          lineItem: {
            select: {
              description: true,
              serviceType: { select: { name: true, admitsCount: true } },
            },
          },
        },
      },
    },
  });

  const rows: EntrantRow[] = [];
  for (const o of orders) {
    const paidAt = o.payments[0]?.createdAt.toISOString() ?? "";
    for (const a of o.attendees) {
      const heads = Math.max(1, a.lineItem?.serviceType?.admitsCount ?? 1);
      const unit = Math.floor((a.seat ?? 0) / heads);
      const partner = o.attendees
        .filter(
          (b) =>
            b !== a &&
            b.lineItemId === a.lineItemId &&
            Math.floor((b.seat ?? 0) / heads) === unit,
        )
        .map((b) => b.name ?? "")
        .join(" & ");
      rows.push({
        division: a.lineItem?.serviceType?.name ?? a.lineItem?.description ?? "",
        player: a.name ?? "",
        partner,
        order: o.id,
        email: o.registrantEmail,
        paid_at: paidAt,
      });
    }
  }
  return rows;
}
