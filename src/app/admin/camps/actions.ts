"use server";

import { revalidatePath } from "next/cache";
import type { EventStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin, requireCoordinator } from "@/server/admin";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/** Allowed forward transitions in the purge state machine (decision #4). */
const NEXT: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["ACTIVE", "DRAFT"],
  ACTIVE: ["CLOSED"],
  CLOSED: ["PURGEABLE"],
  PURGEABLE: ["PURGED"],
  PURGED: [],
};

export async function createCamp(input: {
  name: string;
  code: string;
  startsAt: string;
  endsAt: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name) return { ok: false, error: "Name is required." };
  if (!/^[A-Z]{2,4}-\d{4}[SW]$/.test(code)) {
    return { ok: false, error: "Code must look like MC-2026W." };
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (isNaN(+startsAt) || isNaN(+endsAt)) {
    return { ok: false, error: "Valid start and end dates required." };
  }

  const dupe = await db.event.findUnique({
    where: { orgId_code: { orgId: org.id, code } },
  });
  if (dupe) return { ok: false, error: `Code ${code} is already used.` };

  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "CAMP",
      status: "DRAFT",
      name,
      code,
      startsAt,
      endsAt,
    },
  });
  revalidatePath("/admin/camps");
  return { ok: true, id: event.id };
}

export async function updateCamp(
  id: string,
  patch: { name: string; startsAt: string; endsAt: string },
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const startsAt = new Date(patch.startsAt);
  const endsAt = new Date(patch.endsAt);
  if (!patch.name.trim() || isNaN(+startsAt) || isNaN(+endsAt)) {
    return { ok: false, error: "Name and valid dates required." };
  }

  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: { name: patch.name.trim(), startsAt, endsAt },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

export async function transitionCamp(
  id: string,
  target: EventStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const event = await db.event.findFirst({ where: { id, orgId: org.id } });
  if (!event) return { ok: false, error: "Camp not found." };

  if (!NEXT[event.status].includes(target)) {
    return { ok: false, error: `Can't move from ${event.status} to ${target}.` };
  }

  // PURGED is destructive — coordinator-only, strips PII, keeps anon counts.
  if (target === "PURGED") {
    await requireCoordinator();
    await db.$transaction([
      db.attendee.updateMany({
        where: { eventId: id, orgId: org.id },
        data: { name: null, mailingAddress: null, piiPurgedAt: new Date() },
      }),
      db.event.update({
        where: { id },
        data: { status: "PURGED", purgedAt: new Date() },
      }),
    ]);
    revalidatePath(`/admin/camps/${id}`);
    return { ok: true };
  }

  await db.event.update({
    where: { id },
    data: {
      status: target,
      ...(target === "CLOSED" ? { closedAt: new Date() } : {}),
    },
  });
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}

export async function setWalkIn(
  id: string,
  open: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const res = await db.event.updateMany({
    where: { id, orgId: org.id },
    data: { walkInOpensAt: open ? new Date() : null },
  });
  if (res.count === 0) return { ok: false, error: "Camp not found." };
  revalidatePath(`/admin/camps/${id}`);
  return { ok: true };
}
