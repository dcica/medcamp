import { env } from "@/lib/env";

/**
 * Pluggable email (Platform-Mandate §6). When no provider key is configured the
 * message is logged to the console so local dev and self-host work out of the
 * box. Resend/SendGrid/SMTP adapters slot in here without touching callers.
 */
export type ConfirmationEmail = {
  to: string;
  registrantName: string;
  eventName: string;
  confirmUrl: string;
  campIds: string[];
};

export async function sendConfirmationEmail(msg: ConfirmationEmail): Promise<void> {
  const body = [
    `Hi ${msg.registrantName},`,
    `Your registration for ${msg.eventName} is confirmed.`,
    `Camp ID(s): ${msg.campIds.join(", ")}`,
    `View your QR badge: ${msg.confirmUrl}`,
  ].join("\n");

  const hasProvider =
    (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) ||
    (env.EMAIL_PROVIDER === "sendgrid" && env.SENDGRID_API_KEY);

  if (!hasProvider) {
    console.log(
      `\n[email:console] to=${msg.to} from=${env.EMAIL_FROM}\n${body}\n`,
    );
    return;
  }

  // TODO: real provider dispatch (Resend/SendGrid). Console fallback for now.
  console.log(`[email:${env.EMAIL_PROVIDER}] would send to ${msg.to}`);
}
