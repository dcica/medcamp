"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type MemberSearchRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  partySize: number;
  validTo: string; // ISO
  isCurrent: boolean;
};

/**
 * Search the family-member roster by name, email, or phone (coordinator-only,
 * org-scoped). Phone matches on digits only, so "(972) 555" and "972555" both
 * hit. Capped at 50 rows — the search is a lookup, not a full export.
 */
export async function searchMembers(query: string): Promise<MemberSearchRow[]> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const or: Prisma.MemberWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
  ];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) or.push({ phone: { contains: digits } });

  const rows = await db.member.findMany({
    where: { orgId: org.id, OR: or },
    orderBy: { name: "asc" },
    take: 50,
  });

  const now = Date.now();
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    partySize: m.partySize,
    validTo: m.validTo.toISOString(),
    isCurrent: m.validTo.getTime() >= now,
  }));
}

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
