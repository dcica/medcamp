import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Registration service. Creates a PENDING order + attendees + line items from a
 * validated form submission. Nothing is confirmed here — payment confirmation
 * (webhook or cash) is the authoritative step (see payments.ts). Prices come
 * from the org's ServiceType menu, never from the client.
 */

export const registrationSchema = z.object({
  eventId: z.string().min(1),
  registrant: z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().min(7, "Phone is required"),
  }),
  marketingConsent: z.boolean().default(false),
  attendees: z
    .array(
      z.object({
        name: z.string().min(1, "Attendee name is required"),
        mailingAddress: z.string().optional(),
        serviceKeys: z.array(z.string()).min(1, "Pick at least one service"),
      }),
    )
    .min(1, "Add at least one attendee"),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export type CreatedOrder = {
  orderId: string;
  totalCents: number;
};

export async function createRegistration(
  input: RegistrationInput,
): Promise<CreatedOrder> {
  const data = registrationSchema.parse(input);

  const event = await db.event.findUniqueOrThrow({
    where: { id: data.eventId },
    include: { org: true },
  });
  if (event.status !== "OPEN") {
    throw new Error("Registration for this event is not open.");
  }

  // Resolve services from the org menu (server-side pricing only).
  const services = await db.serviceType.findMany({
    where: { orgId: event.orgId, active: true },
  });
  const byKey = new Map(services.map((s) => [s.key, s]));

  // Validate every requested service exists & is active.
  for (const att of data.attendees) {
    for (const key of att.serviceKeys) {
      if (!byKey.has(key)) {
        throw new Error(`Unknown or inactive service: ${key}`);
      }
    }
  }

  const totalCents = data.attendees.reduce(
    (sum, att) =>
      sum +
      att.serviceKeys.reduce((s, k) => s + (byKey.get(k)?.priceCents ?? 0), 0),
    0,
  );

  const order = await db.order.create({
    data: {
      orgId: event.orgId,
      eventId: event.id,
      status: "PENDING",
      registrantName: data.registrant.name,
      registrantEmail: data.registrant.email,
      registrantPhone: data.registrant.phone,
      marketingConsent: data.marketingConsent,
      marketingConsentAt: data.marketingConsent ? new Date() : null,
      method: totalCents === 0 ? "CASH" : "STRIPE",
      attendees: {
        create: data.attendees.map((att) => ({
          orgId: event.orgId,
          eventId: event.id,
          name: att.name,
          mailingAddress: att.mailingAddress,
        })),
      },
    },
    include: { attendees: true },
  });

  // Create line items, attaching each to its attendee.
  const lineItemData = data.attendees.flatMap((att, i) => {
    const attendee = order.attendees[i];
    return att.serviceKeys.map((key) => {
      const st = byKey.get(key)!;
      return {
        orgId: event.orgId,
        orderId: order.id,
        attendeeId: attendee.id,
        serviceTypeId: st.id,
        description: `${st.name} — ${att.name}`,
        amountCents: st.priceCents,
        status: "PENDING_PAYMENT" as const,
      };
    });
  });
  await db.lineItem.createMany({ data: lineItemData });

  return { orderId: order.id, totalCents };
}
