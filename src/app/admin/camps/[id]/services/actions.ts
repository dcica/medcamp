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
  active: boolean;
  capacity: number;
};

/** Create a new org service + its cap for this camp. */
export async function createService(
  eventId: string,
  input: Omit<RowInput, "active">,
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

  const service = await db.serviceType.create({
    data: {
      orgId: org.id,
      key,
      name: input.name.trim(),
      priceCents: Math.round(input.priceDollars * 100),
      colorHex: input.colorHex,
      hasLab: input.hasLab,
    },
  });
  await db.serviceCap.create({
    data: {
      eventId,
      serviceTypeId: service.id,
      capacity: Math.max(0, Math.round(input.capacity)),
    },
  });
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}

/** Update an org service + upsert its per-camp cap. */
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

  const capacity = Math.max(0, Math.round(input.capacity));
  const existingCap = await db.serviceCap.findUnique({
    where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
  });
  if (existingCap && capacity < existingCap.sold) {
    return {
      ok: false,
      error: `Capacity can't be below ${existingCap.sold} already sold.`,
    };
  }

  await db.$transaction([
    db.serviceType.update({
      where: { id: serviceId },
      data: {
        name: input.name.trim(),
        priceCents: Math.round(input.priceDollars * 100),
        colorHex: input.colorHex,
        hasLab: input.hasLab,
        active: input.active,
      },
    }),
    db.serviceCap.upsert({
      where: { eventId_serviceTypeId: { eventId, serviceTypeId: serviceId } },
      update: { capacity },
      create: { eventId, serviceTypeId: serviceId, capacity },
    }),
  ]);
  revalidatePath(`/admin/camps/${eventId}/services`);
  return { ok: true };
}
