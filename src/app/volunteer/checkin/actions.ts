"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/session";
import { signInVolunteer, signOutVolunteer } from "@/server/volunteers";

export type ActionResult = { ok: true } | { ok: false; error: string };

const CHECKIN_ROLES = [
  "COORDINATOR",
  "VOLUNTEER_COORDINATOR",
  "COMMITTEE_ADMIN",
  "STATION_VOLUNTEER",
] as const;

export async function signInAction(code: string): Promise<ActionResult> {
  await requireRole(...CHECKIN_ROLES);
  try {
    await signInVolunteer(code);
    revalidatePath(`/volunteer/checkin/${encodeURIComponent(code)}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function signOutAction(code: string): Promise<ActionResult> {
  await requireRole(...CHECKIN_ROLES);
  try {
    await signOutVolunteer(code);
    revalidatePath(`/volunteer/checkin/${encodeURIComponent(code)}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}
