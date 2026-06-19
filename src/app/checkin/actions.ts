"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/session";
import {
  signWaiver as svcSignWaiver,
  checkInAttendee as svcCheckIn,
} from "@/server/checkin";

const CHECKIN_ROLES = [
  "REGISTRATION_TILL",
  "REGISTRATION_NO_TILL",
  "STATION_VOLUNTEER",
] as const;

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function signWaiverAction(campId: string): Promise<ActionResult> {
  await requireRole(...CHECKIN_ROLES);
  try {
    await svcSignWaiver(campId);
    revalidatePath(`/checkin/${campId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function checkInAction(campId: string): Promise<ActionResult> {
  await requireRole(...CHECKIN_ROLES);
  try {
    await svcCheckIn(campId);
    revalidatePath(`/checkin/${campId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}
