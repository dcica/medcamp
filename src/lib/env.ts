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
  EMAIL_PROVIDER: z.enum(["resend", "sendgrid", "smtp"]).default("resend"),
  EMAIL_FROM: z.string().default("dcica <no-reply@example.org>"),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
});

// During `next build` without a real DB, fall back so the build doesn't crash.
const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.warn(
    "[env] Invalid or missing environment variables:",
    parsed.error.flatten().fieldErrors,
  );
}

export const env = (parsed.success ? parsed.data : ({} as z.infer<typeof schema>));

/** Which OIDC providers are configured (drives the login screen). */
export const enabledOidcProviders = {
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
  github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
};
