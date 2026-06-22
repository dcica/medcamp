"use server";

import { revalidatePath } from "next/cache";
import { requireVolunteerCoordinator } from "@/server/admin";
import {
  sendReminders,
  issueCertificates,
  setHours,
  markNoShow,
} from "@/server/volunteers";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function sendRemindersAction(eventId?: string): Promise<ActionResult> {
  await requireVolunteerCoordinator();
  try {
    const n = await sendReminders(eventId);
    return { ok: true, message: `Reminders sent to ${n} volunteer(s).` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function issueCertificatesAction(eventId?: string): Promise<ActionResult> {
  await requireVolunteerCoordinator();
  try {
    const n = await issueCertificates(eventId);
    revalidatePath("/volunteers");
    return { ok: true, message: `Issued ${n} certificate(s) + thank-you email(s).` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function setHoursAction(
  signupId: string,
  hours: number,
): Promise<ActionResult> {
  await requireVolunteerCoordinator();
  try {
    await setHours(signupId, hours);
    revalidatePath("/volunteers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function markNoShowAction(signupId: string): Promise<ActionResult> {
  await requireVolunteerCoordinator();
  try {
    await markNoShow(signupId);
    revalidatePath("/volunteers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}
