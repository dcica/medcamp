"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type RowInput = {
  name: string;
  priceDollars: number;
  colorHex: string;
  hasLab: boolean;
  fulfillable: boolean;
  active: boolean;
  /** Whether this service is offered at THIS event (controls cap existence). */
  offered: boolean;
  capacity: number;
};

/** Create a new catalogue service + offer it at this camp (cap with price). */
export async function createService(
  eventId: string,
  input: Omit<RowInput, "active" | "offered">,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const event = await db.event.findFirst({ where: { id: eventId, orgId: org.id } });
  if (!event) return { ok: false, error: "Camp not found." };

  const key = slugify(input.name);
  if (!key) return { ok: false, error: "Name must contain letters or numbers." };

  const exists = await db.serviceType.findUnique({
    where: { orgId_key: { orgId: org.id, key } },
  });
  if (exists) return { ok: false, error: `A service "${key}" already exists.` };

  const priceCents = Math.max(0, Math.round(input.priceDollars * 100));
  const service = await db.serviceType.create({
    data: {
      orgId: org.id,
      key,
      name: input.name.trim(),
      // Catalogue default price (seeds future offerings); per-event price below.
      priceCents,
      colorHex: input.colorHex,
      hasLab: input.hasLab,
      fulfillable: input.fulfillable,
    },
  });
  await db.serviceCap.create({
    data: {
      eventId,
      serviceTypeId: service.id,
      priceCents,
      capacity: Math.max(0, Math.round(input.capacity)),
    },
  });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}

/**
 * Update a service's catalogue attributes (org-wide) and its per-event offering.
 * Price + capacity live on the per-event cap; toggling `offered` adds/removes the
 * offering (and thus whether the service appears in this event's registration).
 */
export async function saveServiceRow(
  eventId: string,
  serviceId: string,
  input: RowInput,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const service = await db.serviceType.findFirst({
    where: { id: serviceId, orgId: org.id },
  });
  if (!service) return { ok: false, error: "Service not found." };

  const priceCents = Math.max(0, Math.round(input.priceDollars * 100));
  const capacity = Math.max(0, Math.round(input.capacity));
  const existingCap = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
  });

  // Catalogue attributes (org-wide). Price is NOT here — it's per-event.
  const updateCatalog = db.serviceType.update({
    where: { id: serviceId },
    data: {
      name: input.name.trim(),
      colorHex: input.colorHex,
      hasLab: input.hasLab,
      fulfillable: input.fulfillable,
      active: input.active,
    },
  });

  if (!input.offered) {
    if (existingCap && existingCap.sold > 0) {
      return {
        ok: false,
        error: `Can't remove — ${existingCap.sold} already sold this camp.`,
      };
    }
    await db.$transaction([
      updateCatalog,
      ...(existingCap
        ? [db.serviceCap.delete({ where: { id: existingCap.id } })]
        : []),
    ]);
  } else {
    if (existingCap && capacity < existingCap.sold) {
      return {
        ok: false,
        error: `Capacity can't be below ${existingCap.sold} already sold.`,
      };
    }
    await db.$transaction([
      updateCatalog,
      db.serviceCap.upsert({
        where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
        update: { priceCents, capacity },
        create: { eventId, serviceTypeId: serviceId, priceCents, capacity },
      }),
    ]);
  }
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}
