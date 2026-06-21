import { z } from "zod";

/**
 * Validated environment. Import `env` anywhere instead of touching process.env.
 * Providers are pluggable (Platform-Mandate §6): a blank section disables that
 * provider rather than crashing — so most provider keys are optional and the app
 * degrades gracefully (e.g. email logs to console, OIDC provider simply hidden).
 */
const schema = z.object({
  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().default("localhost:3000"),
  TENANT_ROUTING: z.enum(["subdomain", "path"]).default("path"),
  // Approach C: single active tenant for now. Resolved by slug; subdomain
  // routing is the future seam. See getActiveOrg().
  DEFAULT_ORG_SLUG: z.string().default("dcica"),
  // Comma-separated emails auto-granted COORDINATOR on first login (bootstrap).
  BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Auth
  NEXTAUTH_SECRET: z.string().min(1).optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Payments
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(["resend", "sendgrid", "smtp", "ses"]).default("resend"),
  EMAIL_FROM: z.string().default("dcica <no-reply@example.org>"),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  // AWS SES (EMAIL_PROVIDER=ses). Region is required; credentials resolve via
  // the standard AWS SDK chain (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env
  // vars, or an attached IAM role on Vercel/EC2). EMAIL_FROM must be a verified
  // SES identity (domain or address) in this region.
  AWS_REGION: z.string().optional(),

  // Address validation (Google Address Validation API — optional).
  // Server-only key. Unset → address fields work as plain inputs.
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Test-only credential login (QA / demos / previews). OFF unless "true".
  // NEVER enable in a real production tenant. See src/lib/testAccounts.ts.
  TEST_LOGIN_ENABLED: z.string().optional(),
  TEST_LOGIN_PASSWORD: z.string().optional(),

  // Logging. Min level emitted by lib/logger (debug | info | warn | error).
  // Unset ⇒ debug in dev, info in prod. (logger reads process.env directly.)
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

// During `next build` without a real DB, fall back so the build doesn't crash.
const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Single-line on purpose; this runs before lib/logger is usable (logger must
  // not import env — circular), so it stays on a raw console call.
  console.warn(
    `[env] invalid/missing environment variables: ${JSON.stringify(
      parsed.error.flatten().fieldErrors,
    )}`,
  );
}

export const env = (parsed.success ? parsed.data : ({} as z.infer<typeof schema>));

/** Which OIDC providers are configured (drives the login screen). */
export const enabledOidcProviders = {
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
  github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
};

/** Address validation is offered only when a Google key is configured. */
export const addressValidationEnabled = Boolean(env.GOOGLE_MAPS_API_KEY);
