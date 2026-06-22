"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type PlanInput = {
  name: string;
  termYears: number;
  priceDollars: number;
  partySize: number;
  active: boolean;
};

/** Create a family membership plan (org-level catalogue). */
export async function createPlan(
  input: Omit<PlanInput, "active">,
): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const key = slugify(input.name);
  if (!key) return { ok: false, error: "Name must contain letters or numbers." };
  const exists = await db.membershipPlan.findUnique({
    where: { orgId_key: { orgId: org.id, key } },
  });
  if (exists) return { ok: false, error: `A plan "${key}" already exists.` };

  await db.membershipPlan.create({
    data: {
      orgId: org.id,
      key,
      name: input.name.trim(),
      termYears: Math.max(1, Math.round(input.termYears)),
      priceCents: Math.max(0, Math.round(input.priceDollars * 100)),
      partySize: Math.max(1, Math.round(input.partySize)),
    },
  });
  revalidatePath("/admin/membership");
  return { ok: true };
}

/** Update a membership plan. */
export async function savePlan(
  planId: string,
  input: PlanInput,
): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const plan = await db.membershipPlan.findFirst({
    where: { id: planId, orgId: org.id },
  });
  if (!plan) return { ok: false, error: "Plan not found." };

  await db.membershipPlan.update({
    where: { id: planId },
    data: {
      name: input.name.trim(),
      termYears: Math.max(1, Math.round(input.termYears)),
      priceCents: Math.max(0, Math.round(input.priceDollars * 100)),
      partySize: Math.max(1, Math.round(input.partySize)),
      active: input.active,
    },
  });
  revalidatePath("/admin/membership");
  return { ok: true };
}
