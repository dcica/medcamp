"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

type InviteInput = {
  email: string;
  role: Role;
  canHoldTill: boolean;
  canOverrideWaiver: boolean;
};

export async function inviteMember(input: InviteInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Valid email required." };
  }

  // Already a member?
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const m = await db.membership.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: existingUser.id } },
    });
    if (m) return { ok: false, error: "That person is already a member." };
  }

  try {
    await db.invite.upsert({
      where: { orgId_email: { orgId: org.id, email } },
      update: {
        role: input.role,
        canHoldTill: input.canHoldTill,
        canOverrideWaiver: input.canOverrideWaiver,
        acceptedAt: null,
      },
      create: {
        orgId: org.id,
        email,
        role: input.role,
        canHoldTill: input.canHoldTill,
        canOverrideWaiver: input.canOverrideWaiver,
      },
    });
    revalidatePath("/admin/members");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function updateMembership(
  membershipId: string,
  patch: { role: Role; canHoldTill: boolean; canOverrideWaiver: boolean },
): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  // Scope the update to the active org so a bad id can't touch another tenant.
  const result = await db.membership.updateMany({
    where: { id: membershipId, orgId: org.id },
    data: patch,
  });
  if (result.count === 0) return { ok: false, error: "Member not found." };
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function removeMembership(
  membershipId: string,
): Promise<ActionResult> {
  const me = await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const target = await db.membership.findFirst({
    where: { id: membershipId, orgId: org.id },
  });
  if (!target) return { ok: false, error: "Member not found." };
  // Prevent removing your own coordinator access (lockout guard).
  if (target.userId === me.userId) {
    return { ok: false, error: "You can't remove your own access." };
  }

  await db.membership.delete({ where: { id: target.id } });
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  await db.invite.deleteMany({ where: { id: inviteId, orgId: org.id } });
  revalidatePath("/admin/members");
  return { ok: true };
}
