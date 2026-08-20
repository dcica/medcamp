import {
  SESv2Client,
  SendEmailCommand,
  GetAccountCommand,
} from "@aws-sdk/client-sesv2";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import {
  buildConfirmationMime,
  confirmationSubject,
  confirmationText,
  type ConfirmationEmail,
} from "@/lib/confirmationEmail";

/**
 * Pluggable email (Platform-Mandate §6). When no provider is configured the
 * message is logged to the console so local dev and self-host work out of the
 * box. AWS SES is wired up; Resend/SendGrid/SMTP adapters slot in the same way.
 */
export type {
  ConfirmationEmail,
  ConfirmationLine,
  ConfirmationMerch,
} from "@/lib/confirmationEmail";

/** Lazily-built SES client (credentials resolve via the standard AWS chain). */
let sesClient: SESv2Client | null = null;
function getSes(): SESv2Client {
  if (!sesClient) {
    // Pass credentials explicitly when env keys are present. The SDK's default
    // provider chain can fail to read AWS_* env vars inside a bundled Next.js
    // serverless function ("Could not load credentials from any providers")
    // even though they ARE in process.env. Reading them directly is
    // deterministic. When the keys are absent (e.g. local dev using
    // AWS_PROFILE), fall back to the default chain so the profile still works.
    const hasEnvKeys =
      Boolean(process.env.AWS_ACCESS_KEY_ID) &&
      Boolean(process.env.AWS_SECRET_ACCESS_KEY);
    sesClient = new SESv2Client({
      region: env.AWS_REGION,
      credentials: hasEnvKeys
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
          }
        : undefined,
    });
  }
  return sesClient;
}

export type EmailConfig = {
  provider: string;
  from: string;
  region: string | null;
  /** True when a real provider is wired up; false ⇒ messages log to console. */
  configured: boolean;
  /** Masked access key id (first4…last4 + length), or null if unset. */
  awsKeyHint: string | null;
  /** Whether AWS_SECRET_ACCESS_KEY is present (length only, never the value). */
  awsSecretLen: number;
};

/**
 * Current email config, for the admin email page (no secrets exposed). Reads
 * the AWS keys from process.env directly (they're consumed by the SDK, not in
 * the zod env schema) so the page can show whether they actually arrived.
 */
export function emailConfig(): EmailConfig {
  const provider = env.EMAIL_PROVIDER;
  const akid = process.env.AWS_ACCESS_KEY_ID ?? "";
  const secret = process.env.AWS_SECRET_ACCESS_KEY ?? "";
  const configured =
    (provider === "ses" &&
      Boolean(env.AWS_REGION) &&
      akid.length > 0 &&
      secret.length > 0) ||
    (provider === "resend" && Boolean(env.RESEND_API_KEY)) ||
    (provider === "sendgrid" && Boolean(env.SENDGRID_API_KEY));
  return {
    provider,
    from: env.EMAIL_FROM,
    region: env.AWS_REGION ?? null,
    configured,
    awsKeyHint: akid
      ? `${akid.slice(0, 4)}…${akid.slice(-4)} (${akid.length} chars)`
      : null,
    awsSecretLen: secret.length,
  };
}

/**
 * Low-level send. Returns whether a real provider delivered it (false ⇒ logged
 * to console because no provider is configured). THROWS on a provider error so
 * callers can decide whether to surface or swallow it.
 *
 * `raw`, when supplied, is a complete MIME message (headers included) and is
 * sent through SESv2's `Content.Raw` instead of `Content.Simple` — that is what
 * lets a message carry inline `cid:` images. `body` is still required and is
 * still the plain-text part inside that MIME; it is also what the no-provider
 * console path logs, so that path never dumps base64.
 */
async function send(
  to: string,
  subject: string,
  body: string,
  raw?: Buffer,
): Promise<{ delivered: boolean }> {
  if (env.EMAIL_PROVIDER === "ses" && env.AWS_REGION) {
    await getSes().send(
      new SendEmailCommand({
        FromEmailAddress: env.EMAIL_FROM,
        Destination: { ToAddresses: [to] },
        Content: raw
          ? { Raw: { Data: raw } }
          : {
              Simple: {
                Subject: { Data: subject, Charset: "UTF-8" },
                Body: { Text: { Data: body, Charset: "UTF-8" } },
              },
            },
      }),
    );
    return { delivered: true };
  }

  const hasOtherProvider =
    (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) ||
    (env.EMAIL_PROVIDER === "sendgrid" && env.SENDGRID_API_KEY);

  if (hasOtherProvider) {
    // TODO: real Resend/SendGrid dispatch. Logged-but-not-sent for now.
    log.warn("email not delivered (provider adapter is a stub)", {
      provider: env.EMAIL_PROVIDER,
      to,
      subject,
    });
    return { delivered: false };
  }

  log.info("email logged to console (no provider configured)", {
    to,
    from: env.EMAIL_FROM,
    subject,
    body,
  });
  return { delivered: false };
}

/**
 * Shared dispatch for transactional mail: send, but log + swallow provider
 * errors rather than rethrow. Email is best-effort and must never break the
 * caller — confirmOrderPaid() runs this after the order is already committed as
 * CONFIRMED, so a thrown error would 500 the Stripe webhook and (because
 * confirmation is idempotent) the retry would skip the email entirely.
 */
async function dispatch(
  to: string,
  subject: string,
  body: string,
  /**
   * Optional raw-MIME builder. Deliberately a thunk rather than a Buffer: QR
   * rendering and MIME assembly then run INSIDE this try, so an image that
   * fails to render is caught on exactly the same path as a provider error and
   * cannot roll back an already-paid, already-confirmed order.
   */
  buildRaw?: () => Promise<Buffer>,
): Promise<void> {
  try {
    let raw: Buffer | undefined;
    if (buildRaw) {
      try {
        raw = await buildRaw();
      } catch (err) {
        // Degrade to the plain-text message rather than send nothing: the guest
        // still gets their codes and the link. Logged loudly because a guest
        // without the inline QR is the thing this feature exists to prevent.
        log.error("confirmation email: MIME/QR build failed, sending text only", {
          to,
          subject,
          err,
        });
      }
    }
    await send(to, subject, body, raw);
  } catch (err) {
    log.error("email send failed", {
      provider: env.EMAIL_PROVIDER,
      to,
      subject,
      err,
    });
  }
}

/**
 * Send a test email (admin email page). Unlike dispatch(), this RETHROWS
 * provider errors so the operator sees exactly why a send failed.
 */
export async function sendTestEmail(
  to: string,
): Promise<{ delivered: boolean }> {
  return send(
    to,
    "Test email — DCICA",
    [
      "This is a test email from the DCICA admin console.",
      "If you received this, your email provider is configured correctly.",
      `Provider: ${env.EMAIL_PROVIDER}`,
      `From: ${env.EMAIL_FROM}`,
    ].join("\n"),
  );
}

export type SesAccountStatus = {
  /** False ⇒ SES sandbox: can only send to verified addresses/domains. */
  productionAccess: boolean;
  /** False ⇒ sending is paused for the whole account. */
  sendingEnabled: boolean;
};

/**
 * SES account posture (sandbox vs production), for the admin email page. A
 * verified domain + valid keys still bounce real recipients while the account
 * is in the sandbox, so surface it. Returns null when not on SES, or when the
 * creds lack ses:GetAccount (the page just omits the banner — graceful).
 */
export async function getSesAccountStatus(): Promise<SesAccountStatus | null> {
  if (env.EMAIL_PROVIDER !== "ses" || !env.AWS_REGION) return null;
  try {
    const res = await getSes().send(new GetAccountCommand({}));
    return {
      productionAccess: Boolean(res.ProductionAccessEnabled),
      sendingEnabled: Boolean(res.SendingEnabled),
    };
  } catch (err) {
    log.warn("SES GetAccount failed; sandbox status unavailable", { err });
    return null;
  }
}

/**
 * The one email that CARRIES the pass instead of linking to it: an HTML body
 * with each ticket's QR embedded as a `cid:` inline image, so it renders with
 * the phone in airplane mode (Test-Plan D-2). The plain-text part is unchanged
 * and remains the fallback. See `src/lib/mime.ts` for why `cid:` and not a
 * hosted image URL.
 *
 * The other senders in this file are deliberately still plain text.
 */
export async function sendConfirmationEmail(msg: ConfirmationEmail): Promise<void> {
  await dispatch(msg.to, confirmationSubject(msg), confirmationText(msg), () =>
    buildConfirmationMime(msg, env.EMAIL_FROM),
  );
}

// ── Volunteer module emails ──────────────────────────────────────────────────

export type VolunteerSignupEmail = {
  to: string;
  volunteerName: string;
  eventName: string;
  roleName: string;
  shift: string | null;
  confirmUrl: string;
};

/** Immediate acknowledgement when a volunteer signs up (Volunteer-Module §2). */
export async function sendVolunteerSignupEmail(
  msg: VolunteerSignupEmail,
): Promise<void> {
  const body = [
    `Hi ${msg.volunteerName},`,
    `Thanks for signing up to volunteer at ${msg.eventName}!`,
    `Role: ${msg.roleName}${msg.shift ? ` · ${msg.shift}` : ""}`,
    `Your confirmation + day-of QR sign-in code: ${msg.confirmUrl}`,
    `We'll send a reminder with arrival details before the event.`,
  ].join("\n");
  await dispatch(msg.to, `You're signed up for ${msg.eventName}`, body);
}

export type VolunteerReminderEmail = {
  to: string;
  volunteerName: string;
  eventName: string;
  roleName: string;
  shift: string | null;
  instructions: string | null;
  confirmUrl: string;
};

/** 24–48h reminder with QR + instructions (Volunteer-Module §4). */
export async function sendVolunteerReminderEmail(
  msg: VolunteerReminderEmail,
): Promise<void> {
  const body = [
    `Hi ${msg.volunteerName},`,
    `Reminder: you're volunteering at ${msg.eventName} as ${msg.roleName}` +
      `${msg.shift ? ` (${msg.shift})` : ""}.`,
    msg.instructions ? `What to know: ${msg.instructions}` : "",
    `Bring this QR code to sign in fast: ${msg.confirmUrl}`,
    `Can't make it? Use the cancel link on that page so we can fill your spot.`,
  ]
    .filter(Boolean)
    .join("\n");
  await dispatch(msg.to, `Reminder: ${msg.eventName} is almost here`, body);
}

export type VolunteerThankYouEmail = {
  to: string;
  volunteerName: string;
  eventName: string;
  hoursServed: number | null;
  certUrl: string;
};

/** Post-event thank-you carrying the certificate link (Volunteer-Module §7). */
export async function sendVolunteerThankYouEmail(
  msg: VolunteerThankYouEmail,
): Promise<void> {
  const hours =
    msg.hoursServed != null ? `${msg.hoursServed.toFixed(1)} hours` : "your time";
  const body = [
    `Hi ${msg.volunteerName},`,
    `Thank you for volunteering ${hours} at ${msg.eventName} — we couldn't run`,
    `the event without you.`,
    `Download your certificate of appreciation: ${msg.certUrl}`,
    `Hope to see you at the next one!`,
  ].join("\n");
  await dispatch(msg.to, `Thank you for volunteering at ${msg.eventName}`, body);
}
