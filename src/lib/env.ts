import { z } from "zod";

/**
 * The only accepted shape for a GA4 measurement id. Exported so
 * scripts/verify-branding.ts §15 pins the SAME expression the schema uses —
 * a copy in the test would pass while the real guard rotted.
 */
export const GA_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,24}$/;

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
  /**
   * Whether THIS deployment may be indexed by search engines.
   *
   * `off` makes robots.txt refuse every crawler, empties the sitemap, and puts
   * `noindex` on every page including the public ones.
   *
   * It exists because `test.dcica.org` is a fully public, fully working copy of
   * the storefront — same posters, same prices, same copy — running Stripe in
   * TEST MODE. Indexed, it competes with `events.dcica.org` for the exact local
   * queries the rest of this change is aimed at, and it can win: it is the same
   * content on a shorter path. The failure mode is not a ranking loss, it is a
   * neighbour finding "dandiya night flower mound", landing on the test site,
   * and completing a checkout that takes no money and issues no ticket.
   *
   * Defaults to `on`, so a self-hoster with one environment is indexable
   * without configuring anything, and only a deliberately-secondary deployment
   * has to say so. Set `SEARCH_INDEXING=off` on medcamp-test.
   */
  SEARCH_INDEXING: z.enum(["on", "off"]).default("on"),

  /**
   * Google Search Console's HTML-tag verification token — the opaque string
   * from `<meta name="google-site-verification" content="...">`.
   *
   * Env rather than a tenant setting because it identifies a DEPLOYMENT to
   * Google, not an organisation: test and prod are two separate Search Console
   * properties with two different tokens, and they share one database. A
   * tenant-settings value would give both environments the same token and
   * verify neither.
   *
   * Unset means no tag is emitted, which is correct for a self-hoster who has
   * not claimed the property. DNS-record verification needs nothing here.
   */
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().min(8).max(200).optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  /**
   * Server-only Supabase credential. Accepts either the legacy `service_role`
   * JWT or a new-style `sb_secret_...` key — they are passed identically.
   *
   * Named for what it IS rather than which generation it belongs to. The old
   * name (SUPABASE_SERVICE_ROLE_KEY) invited exactly the mix-up it got: an
   * ANON key stored under it, which would have reported storage as configured
   * and then 403d every upload. Prefer sb_secret_ for new setups — it can be
   * rotated on its own, where rotating a legacy service_role key means
   * rotating the project JWT secret and invalidating every legacy key at once.
   */
  SUPABASE_SECRET_KEY: z.string().optional(),
  // Object storage (song uploads). Private bucket; one per environment, since
  // test and prod share a Supabase project in places. Unset URL/service key ⇒
  // uploads are disabled and entrants use the offline delivery option.
  SUPABASE_STORAGE_BUCKET: z.string().default("event-songs"),
  // Separate bucket because banners are PUBLIC (rendered to anonymous
  // visitors) while songs are private. One bucket cannot be both.
  SUPABASE_BANNER_BUCKET: z.string().default("event-banners"),

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
  /**
   * HMAC key for the checkout-resume cookie (src/lib/checkoutResume.ts), which
   * is what lets a buyer who backed out of Stripe finish paying without
   * retyping. Optional: falls back to NEXTAUTH_SECRET, then STRIPE_SECRET_KEY,
   * so resume works out of the box wherever checkout does. Set it explicitly to
   * rotate resume proofs without touching auth sessions or Stripe keys.
   */
  CHECKOUT_RESUME_SECRET: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(["resend", "sendgrid", "smtp", "ses"]).default("resend"),
  EMAIL_FROM: z.string().default("DCICA <no-reply@example.org>"),
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

  /**
   * Google Analytics 4 measurement ID (`G-XXXXXXXXXX`). Unset ⇒ no analytics
   * script is emitted at all, which is the default for a self-hoster and for
   * local dev — a tenant opts in, and its ID is its own (this is per-tenant
   * config, never a hardcoded platform value).
   *
   * Shape-validated on purpose: this value is interpolated into an INLINE
   * <script> in the document (gtag needs the id inside the snippet, not just
   * in a URL). An unvalidated env string there is arbitrary JS execution on
   * every page — same class of hole as an unvalidated branding colour landing
   * in the <html> style attribute (see lib/branding.ts). The regex admits
   * exactly what Google issues, so nothing that could close the script tag or
   * inject a statement survives it. Do not relax it to z.string().
   */
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z
    .string()
    .regex(GA_MEASUREMENT_ID_RE, "must look like G-XXXXXXXXXX")
    .optional(),
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

/**
 * Analytics is emitted only when the tenant has configured a valid measurement
 * ID. A malformed ID fails the schema above, so it arrives here as undefined
 * and the site renders with no tracking rather than with a broken snippet.
 */
export const analyticsEnabled = Boolean(env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
