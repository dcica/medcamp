"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";
import { autoStationColor } from "@/lib/stationColors";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function ownedEvent(eventId: string) {
  const org = await getActiveOrg();
  if (!org) return null;
  return db.event.findFirst({ where: { id: eventId, orgId: org.id } });
}

export async function createStation(
  eventId: string,
  name: string,
): Promise<ActionResult> {
  await requireAdmin();
  if (!(await ownedEvent(eventId))) return { ok: false, error: "Camp not found." };
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const key = slugify(name);
  if (!key) return { ok: false, error: "Name must contain letters or numbers." };

  const dupe = await db.station.findUnique({
    where: { eventId_key: { eventId, key } },
  });
  if (dupe) return { ok: false, error: `Station "${key}" already exists.` };

  const last = await db.station.findFirst({
    where: { eventId },
    orderBy: { sequence: "desc" },
  });
  const sequence = (last?.sequence ?? -1) + 1;

  const org = await getActiveOrg();
  await db.station.create({
    data: {
      orgId: org!.id,
      eventId,
      key,
      name: name.trim(),
      sequence,
      colorHex: autoStationColor(key, sequence),
    },
  });
  revalidatePath(`/admin/camps/${eventId}/stations`);
  return { ok: true };
}

export async function updateStation(
  eventId: string,
  stationId: string,
  patch: { name: string; active: boolean },
): Promise<ActionResult> {
  await requireAdmin();
  if (!(await ownedEvent(eventId))) return { ok: false, error: "Camp not found." };
  const res = await db.station.updateMany({
    where: { id: stationId, eventId },
    data: { name: patch.name.trim(), active: patch.active },
  });
  if (res.count === 0) return { ok: false, error: "Station not found." };
  revalidatePath(`/admin/camps/${eventId}/stations`);
  return { ok: true };
}

/** Swap sequence with the adjacent station (reorder the Care Spine rail). */
export async function moveStation(
  eventId: string,
  stationId: string,
  dir: "up" | "down",
): Promise<ActionResult> {
  await requireAdmin();
  if (!(await ownedEvent(eventId))) return { ok: false, error: "Camp not found." };

  const station = await db.station.findFirst({ where: { id: stationId, eventId } });
  if (!station) return { ok: false, error: "Station not found." };

  const neighbor = await db.station.findFirst({
    where: {
      eventId,
      sequence: dir === "up" ? { lt: station.sequence } : { gt: station.sequence },
    },
    orderBy: { sequence: dir === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return { ok: true }; // already at the edge

  await db.$transaction([
    db.station.update({
      where: { id: station.id },
      data: { sequence: neighbor.sequence },
    }),
    db.station.update({
      where: { id: neighbor.id },
      data: { sequence: station.sequence },
    }),
  ]);
  revalidatePath(`/admin/camps/${eventId}/stations`);
  return { ok: true };
}
