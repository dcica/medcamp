"use server";

import { requireCoordinator } from "@/server/admin";
import { sendTestEmail } from "@/lib/email";
import { getActiveOrg } from "@/lib/tenant";
import { resolveOrgProfile, senderFor } from "@/lib/orgSettings";
import { env } from "@/lib/env";

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
    const org = await getActiveOrg();
    const profile = resolveOrgProfile(org?.settings);
    const { delivered } = await sendTestEmail(trimmed, org?.name ?? "Events", {
      from: senderFor(profile, env.EMAIL_FROM),
      replyTo: profile.contactEmail,
    });
    return { ok: true, delivered };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  }
}
