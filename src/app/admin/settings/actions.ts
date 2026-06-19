"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateOrgSettings(input: {
  name: string;
  brand: string;
}): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const settings = {
    ...(org.settings as Record<string, unknown>),
    brand: input.brand,
  };

  await db.organization.update({
    where: { id: org.id },
    data: { name, settings },
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}
