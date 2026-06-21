"use server";

import { requireCoordinator } from "@/server/admin";
import { sendTestEmail } from "@/lib/email";

export type SendTestResult =
  | { ok: true; delivered: boolean }
  | { ok: false; error: string };

/** Send a test email to verify the configured provider. Coordinator-only. */
export async function sendTestEmailAction(to: string): Promise<SendTestResult> {
  await requireCoordinator();

  const trimmed = to.trim();
  // Minimal shape check — the provider does the real validation on send.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  try {
    const { delivered } = await sendTestEmail(trimmed);
    return { ok: true, delivered };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  }
}
