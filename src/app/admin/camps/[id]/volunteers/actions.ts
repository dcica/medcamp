"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function ownedEvent(eventId: string) {
  const org = await getActiveOrg();
  if (!org) return null;
  const event = await db.event.findFirst({ where: { id: eventId, orgId: org.id } });
  return event ? { org, event } : null;
}

export type RoleInput = {
  name: string;
  description: string;
  minAge: number;
  capacity: number;
  shift: string;
  instructions: string;
  requiresClearance: boolean;
  active: boolean;
};

export async function createVolunteerRole(
  eventId: string,
  name: string,
): Promise<ActionResult> {
  await requireAdmin();
  const owned = await ownedEvent(eventId);
  if (!owned) return { ok: false, error: "Camp not found." };
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const key = slugify(name);
  if (!key) return { ok: false, error: "Name must contain letters or numbers." };

  const dupe = await db.volunteerRole.findUnique({
    where: { eventId_key: { eventId, key } },
  });
  if (dupe) return { ok: false, error: `Role "${key}" already exists.` };

  await db.volunteerRole.create({
    data: { orgId: owned.org.id, eventId, key, name: name.trim() },
  });
  revalidatePath(`/admin/camps/${eventId}/volunteers`);
  return { ok: true };
}

export async function saveVolunteerRole(
  eventId: string,
  roleId: string,
  input: RoleInput,
): Promise<ActionResult> {
  await requireAdmin();
  if (!(await ownedEvent(eventId))) return { ok: false, error: "Camp not found." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  if (input.minAge < 0 || input.capacity < 0) {
    return { ok: false, error: "Age and capacity can't be negative." };
  }

  // Guard the capacity against current occupancy.
  const filled = await db.volunteerSignup.count({
    where: {
      roleId,
      status: { in: ["SIGNED_UP", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW"] },
    },
  });
  if (input.capacity > 0 && input.capacity < filled) {
    return {
      ok: false,
      error: `Capacity can't be below ${filled} (already signed up).`,
    };
  }

  const res = await db.volunteerRole.updateMany({
    where: { id: roleId, eventId },
    data: {
      name: input.name.trim(),
      description: input.description.trim() || null,
      minAge: input.minAge,
      capacity: input.capacity,
      shift: input.shift.trim() || null,
      instructions: input.instructions.trim() || null,
      requiresClearance: input.requiresClearance,
      active: input.active,
    },
  });
  if (res.count === 0) return { ok: false, error: "Role not found." };
  revalidatePath(`/admin/camps/${eventId}/volunteers`);
  return { ok: true };
}

export async function deleteVolunteerRole(
  eventId: string,
  roleId: string,
): Promise<ActionResult> {
  await requireAdmin();
  if (!(await ownedEvent(eventId))) return { ok: false, error: "Camp not found." };

  const signups = await db.volunteerSignup.count({ where: { roleId } });
  if (signups > 0) {
    return {
      ok: false,
      error: "Can't delete a role with signups — set it inactive instead.",
    };
  }
  const res = await db.volunteerRole.deleteMany({ where: { id: roleId, eventId } });
  if (res.count === 0) return { ok: false, error: "Role not found." };
  revalidatePath(`/admin/camps/${eventId}/volunteers`);
  return { ok: true };
}
