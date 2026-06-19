"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/session";
import {
  startVisit,
  completeVisit,
  addOnsiteService,
} from "@/server/stations";

const STATION_ROLES = ["STATION_VOLUNTEER", "DOCTOR"] as const;

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function startVisitAction(
  visitId: string,
  stationKey: string,
): Promise<ActionResult> {
  await requireRole(...STATION_ROLES);
  try {
    await startVisit(visitId);
    revalidatePath(`/station/${stationKey}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function completeVisitAction(
  visitId: string,
  stationKey: string,
): Promise<ActionResult> {
  await requireRole(...STATION_ROLES);
  try {
    await completeVisit(visitId);
    revalidatePath(`/station/${stationKey}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function addOnsiteServiceAction(
  attendeeId: string,
  serviceTypeId: string,
  stationKey: string,
): Promise<ActionResult> {
  // Add-ons are a clinical decision — doctors only (coordinator is superuser).
  await requireRole("DOCTOR");
  try {
    await addOnsiteService(attendeeId, serviceTypeId);
    revalidatePath(`/station/${stationKey}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
