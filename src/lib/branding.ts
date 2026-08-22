import { z } from "zod";
import { supabasePublicObjectPrefix } from "@/lib/supabase";

/**
 * Per-tenant branding: the parse/validate/fallback layer between
 * `Organization.settings` (arbitrary JSON) and the CSS custom properties the
 * whole app already reads through tailwind.config.ts.
 *
 * Everything here is PURE — no database, no network, no React. That is
 * deliberate: it lets scripts/verify-branding.ts pin the security-critical
 * behaviour (hex validation, contrast refusal, asset-host restriction) without
 * standing up a database or a browser.
 *
 * ── WHY THE LEGACY `settings.brand` KEY IS IGNORED ──────────────────────────
 *
 * The old admin form wrote a single top-level `settings.brand` string, and every
 * environment currently stores `#0d6e6e` (teal) there — while globals.css
 * declares `--brand: #0c3543` (navy) and navy is what every screen actually
 * renders. The two have disagreed harmlessly for as long as they have existed,
 * because nothing ever read the stored value.
 *
 * So a reader that honoured the legacy key would, on the deploy that first reads
 * it, silently restyle the entire production site teal — 240+ token usages, no
 * migration to blame, no review of the visual change. Validation cannot save us:
 * `#0d6e6e` is a valid, AA-contrast hex, so a validating reader would honour it
 * happily.
 *
 * The new shape therefore lives under its own namespaced key, `settings.theme`,
 * and a row that carries only `{brand, locale}` yields NO theme at all: nothing
 * is emitted and globals.css renders exactly the navy it renders today. A
 * tenant's colours change only when somebody deliberately saves a theme.
 *
 * ── WHY EVERY VALUE IS RE-VALIDATED AT RENDER TIME ──────────────────────────
 *
 * `settings` is arbitrary JSON. It is written by the admin action, but also by
 * the seed, by ad-hoc scripts, and by whatever admin screen exists next — and
 * the action that shipped before this module performed NO validation on `brand`
 * whatsoever. Since step 2 interpolates stored values into a style attribute on
 * `<html>`, an unvalidated value is attacker-controlled CSS.
 *
 * Hence validation at BOTH boundaries: `themeSchema` on write, and
 * `brandingStyleVars()` again on read, immediately before interpolation. A value
 * that fails the render-time check is dropped rather than emitted, so the CSS
 * fallback in globals.css wins. The second check is not redundant defence
 * against the first — it is the only check that covers a value the first one
 * never saw.
 */

// ── Colour primitives ───────────────────────────────────────────────────────

/**
 * The ONLY colour syntax allowed anywhere near the emitted style attribute.
 * Not `#abc`, not `rgb()`, not a named colour, not `var(--x)` — a strict
 * six-digit hex is trivially safe to interpolate and loses nothing a tenant
 * needs. Anything looser reintroduces a CSS-injection surface for no benefit.
 */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Render-time guard. Narrow, total, and cheap enough to call per value. */
export function isBrandHex(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

function srgbChannel(byte: number): number {
  const s = byte / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance. Throws on a non-hex — callers gate first. */
export function relativeLuminance(hex: string): number {
  if (!isBrandHex(hex)) throw new Error(`relativeLuminance: not a hex: ${JSON.stringify(hex)}`);
  const r = srgbChannel(parseInt(hex.slice(1, 3), 16));
  const g = srgbChannel(parseInt(hex.slice(3, 5), 16));
  const b = srgbChannel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21, rounded to 2dp (see MIN_CONTRAST). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  // Rounded to 2dp because that is what every published checker reports, and a
  // coordinator who reads "4.5:1" in a checker must not be refused here.
  return Math.round(ratio * 100) / 100;
}

/**
 * WCAG 2.1 AA for NORMAL text — 4.5:1 — not the 3:1 large-text allowance.
 *
 * Each pair really does carry small text, so the large-text exemption does not
 * apply to any of the three:
 *   brand/brandFg   — button labels and link text at 14–16px
 *   accent/accentFg — the header bar's "Staff sign in" link at text-sm (14px)
 *   accent2/accent2Fg — the footer band, which is text-xs (12px), the smallest
 *                       text on the site and the binding case
 *
 * A pair is also allowed to be used the other way round (dark fill + light text
 * or the reverse), and the ratio is symmetric, so one threshold covers both.
 *
 * 7:1 (AAA) was rejected because it would refuse dcica's own shipped, reviewed
 * design: the flag-green footer band carries white text at 4.61:1. (The other two
 * pairs are comfortable — navy/white is 13.08:1, saffron/dark is 8.09:1 — so the
 * footer is the pair that sets the floor, which is the same pair that carries the
 * smallest text. That is not a coincidence worth relying on, but it does mean
 * 4.5:1 is the only threshold that is both meaningful and survivable here.) A
 * validator that rejects the reference tenant is a validator nobody keeps.
 * verify-branding.ts asserts both halves of this claim so the number cannot be
 * quietly raised or lowered without the argument being re-made.
 */
export const MIN_CONTRAST = 4.5;

// ── Asset URLs ──────────────────────────────────────────────────────────────

/** The header mark when the tenant has not supplied one. */
export const DEFAULT_MARK_URL = "/icon.png";

/**
 * A same-origin absolute path: one leading slash, then only characters that are
 * safe unencoded in a path. Rejects `//host` (protocol-relative, i.e. offsite),
 * `..`, backslashes, colons, query strings and fragments.
 */
const SAME_ORIGIN_PATH = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

/** Longer than any legitimate storage URL; a cheap stop on absurd input. */
const MAX_ASSET_URL_LENGTH = 512;

/**
 * WHY ASSET URLS ARE HOST-RESTRICTED.
 *
 * next.config.mjs allows next/image exactly one remote host — the configured
 * Supabase project's, under `/storage/v1/object/public/**` — derived from
 * NEXT_PUBLIC_SUPABASE_URL. An arbitrary URL out of the database therefore
 * either 400s in next/image today, or, the day somebody widens
 * `remotePatterns`, becomes an arbitrary-outbound-request vector: the image
 * optimizer would fetch an attacker-chosen host from our server.
 *
 * So the allowlist here mirrors next.config.mjs rather than trusting it, and is
 * derived from the same env var so test, prod and a self-hoster each admit their
 * own host and nothing else. Neither URL is ever fetched server-side by this
 * code — it is handed to next/image and that is all.
 *
 * Returns the URL when allowed, null otherwise. Callers fall back.
 */
export function sanitizeAssetUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_ASSET_URL_LENGTH) return null;

  if (value.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(value) && !value.includes("..") ? value : null;
  }

  const prefix = supabasePublicObjectPrefix();
  if (!prefix) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Compare the normalized href, not the raw string: `new URL` collapses the
  // dot segments and case-folds the host, so a `https://HOST/storage/v1/object/
  // public/../../secret` cannot slip past a naive startsWith on the input.
  if (url.protocol !== "https:") return null;
  if (url.search || url.hash) return null;
  if (!url.href.startsWith(prefix)) return null;
  return url.href;
}

// ── The theme shape ─────────────────────────────────────────────────────────

const hexField = z
  .string()
  .trim()
  .regex(HEX6, "Use a six-digit hex colour, like #0c3543.");

const assetField = z
  .string()
  .trim()
  .refine((v) => sanitizeAssetUrl(v) !== null, {
    message:
      "Logo URLs must be a path on this site or a public object in the configured storage bucket.",
  });

/**
 * WHY ALL SIX COLOURS ARE REQUIRED TOGETHER rather than merged field-by-field
 * over the defaults: contrast is a property of a PAIR. A theme that sets
 * `accent` alone would be checked against the DEFAULT foreground, then rendered
 * against it too — which is how you ship navy text on a navy bar. Requiring the
 * partner colour makes every emitted pair one that was actually validated.
 *
 * The consequence, deliberately: a partial or malformed theme is not a partial
 * theme, it is NO theme, and the app renders its own reviewed defaults. Falling
 * back to a known-good palette is always safe; half-applying an unvalidated one
 * is not.
 */
export const themeSchema = z
  .object({
    brand: hexField,
    brandFg: hexField,
    accent: hexField,
    accentFg: hexField,
    accent2: hexField,
    accent2Fg: hexField,
    /**
     * The short mark beside the logo in the header bar — not the org's full
     * name, which the footer and page headings carry. Capped at 8 characters
     * because it sits inline in a 375px-wide bar next to a control.
     */
    wordmark: z.string().trim().min(1).max(8),
    /** Square logo, rendered round-cropped at 28px in the header. */
    markUrl: assetField.optional(),
    /** Horizontal lockup for badges, certificates and email — never the app bar. */
    lockupUrl: assetField.optional(),
  })
  .strict()
  .superRefine((theme, ctx) => {
    const pairs: Array<[keyof typeof theme, keyof typeof theme, string]> = [
      ["brand", "brandFg", "Brand"],
      ["accent", "accentFg", "Accent"],
      ["accent2", "accent2Fg", "Accent 2"],
    ];
    for (const [bg, fg, label] of pairs) {
      // Zod runs superRefine even when a FIELD-level check already failed, so
      // these can still be non-hex here. Gate before measuring: contrastRatio
      // throws on a non-hex, and an uncaught throw in this schema is an uncaught
      // throw in the ROOT LAYOUT — i.e. every page 500s because one database
      // column holds a typo. The field-level regex has already reported it.
      if (!isBrandHex(theme[bg]) || !isBrandHex(theme[fg])) continue;
      const ratio = contrastRatio(theme[bg] as string, theme[fg] as string);
      if (ratio < MIN_CONTRAST) {
        // Refuse rather than store: an unreadable pair is not a cosmetic
        // preference, it is a screen a volunteer cannot use at a gate.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [fg as string],
          message: `${label} text only reaches ${ratio}:1 against its background — ${MIN_CONTRAST}:1 is the minimum for readable text. Pick a lighter or darker text colour.`,
        });
      }
    }
  });

export type Theme = z.infer<typeof themeSchema>;

/**
 * The app's own palette, i.e. what globals.css declares and every screen renders
 * today. Kept here so the admin form can seed its fields from what is actually
 * on screen instead of from the stale legacy value, and so a coordinator who
 * changes only one colour gets a complete, validated theme.
 *
 * These must stay in step with the `:root` block in globals.css. verify-branding
 * asserts exactly that.
 */
export const DEFAULT_THEME: Theme = {
  brand: "#0c3543",
  brandFg: "#ffffff",
  accent: "#f9a200",
  accentFg: "#16201f",
  accent2: "#138808",
  accent2Fg: "#ffffff",
  wordmark: "DCICA",
};

/**
 * Header mark and footer name before any organization row exists — the
 * `getActiveOrg()` null case, which is a self-hoster's first boot. It stays the
 * reference tenant's literal so that this change is provably no-visual-change:
 * these are the exact strings SiteHeader/SiteFooter hardcoded before.
 */
const FALLBACK_WORDMARK = "DCICA";
const FALLBACK_ORG_NAME = "DCICA";

export type Branding = {
  /** null ⇒ emit nothing; globals.css keeps the app defaults. */
  theme: Theme | null;
  /** Short mark for the header bar. Never empty. */
  wordmark: string;
  /** Header logo. Never empty — falls back to DEFAULT_MARK_URL. */
  markUrl: string;
  /** Horizontal lockup, or null when the tenant has not supplied one. */
  lockupUrl: string | null;
  /** Full org name for the footer and headings. Never empty. */
  orgName: string;
};

/**
 * Read branding out of an `Organization.settings` blob. Total: every input,
 * including `undefined`, `null`, `{}`, a legacy `{brand, locale}` row, a string,
 * or a hostile blob, yields a usable Branding.
 */
export function resolveBranding(
  settings: unknown,
  orgName?: string | null,
): Branding {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).theme
      : undefined;

  // try/catch around safeParse is not paranoia here: this function runs in the
  // ROOT LAYOUT on every request, so anything it throws is a site-wide 500 caused
  // by one malformed JSON column. "No theme" is always a safe answer; throwing
  // never is.
  let theme: Theme | null = null;
  try {
    const parsed = themeSchema.safeParse(raw);
    if (parsed.success) theme = parsed.data;
  } catch {
    theme = null;
  }

  const name = typeof orgName === "string" && orgName.trim() ? orgName.trim() : null;

  return {
    theme,
    wordmark: theme?.wordmark ?? name ?? FALLBACK_WORDMARK,
    // Re-sanitized on read even though the schema already checked it: the blob
    // can be written by a seed or a script that never went through the schema.
    markUrl: sanitizeAssetUrl(theme?.markUrl) ?? DEFAULT_MARK_URL,
    lockupUrl: sanitizeAssetUrl(theme?.lockupUrl),
    orgName: name ?? FALLBACK_ORG_NAME,
  };
}

/** The CSS custom properties, in the exact names globals.css declares. */
const VAR_NAMES = {
  brand: "--brand",
  brandFg: "--brand-fg",
  accent: "--accent",
  accentFg: "--accent-fg",
  accent2: "--accent-2",
  accent2Fg: "--accent-2-fg",
} as const;

/** Order is fixed so the emitted output is deterministic and diffable. */
const VAR_KEYS = Object.keys(VAR_NAMES) as Array<keyof typeof VAR_NAMES>;

/**
 * Build the custom properties for the style attribute on `<html>`.
 *
 * THE RENDER-TIME GUARD LIVES HERE, immediately before the values reach the DOM.
 * `isBrandHex` is re-applied per value even though `themeSchema` already
 * enforced it, because this function is the last thing between arbitrary JSON in
 * a database column and CSS in the page — and the write path that put the JSON
 * there is not guaranteed to be the one in this repo. A value that fails is
 * dropped, so `var(--brand, #0c3543)` in tailwind.config.ts falls through to the
 * default rather than the page rendering something unreadable or attacker-chosen.
 *
 * Returns undefined — never an empty object and never the string "undefined" —
 * when there is nothing to emit, so the caller can omit the attribute entirely.
 */
export function brandingStyleVars(
  theme: Theme | null | undefined,
): Record<string, string> | undefined {
  if (!theme) return undefined;
  const vars: Record<string, string> = {};
  for (const key of VAR_KEYS) {
    const value = (theme as Record<string, unknown>)[key];
    if (!isBrandHex(value)) continue; // drop, do not emit — see above
    vars[VAR_NAMES[key]] = value;
  }
  return Object.keys(vars).length > 0 ? vars : undefined;
}

/**
 * Text form of the same declarations. Not used to render — the layout emits a
 * style ATTRIBUTE, which React serializes for us — but it gives the verify suite
 * and any future debug view one canonical string to assert against.
 */
export function brandingStyleText(theme: Theme | null | undefined): string {
  const vars = brandingStyleVars(theme);
  if (!vars) return "";
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

/**
 * Compose a COMPLETE, validated theme from a single brand colour plus whatever
 * the tenant already had. This is what lets the admin form's one "Brand color"
 * field keep working without becoming the step-4 theme editor: the coordinator
 * supplies the one colour they care about, and the server supplies a foreground
 * that is actually readable against it and leaves the other two pairs alone.
 *
 * The foreground is chosen, not asked for, because the form has no field for it.
 * It picks whichever of the design system's two text tokens contrasts better,
 * then the schema re-checks it — so a mid-tone that neither token can carry is
 * refused rather than silently shipped at 3:1.
 */
export function themeWithBrand(
  current: Theme | null,
  brand: string,
): { ok: true; theme: Theme } | { ok: false; error: string } {
  const base = current ?? DEFAULT_THEME;
  const candidate = brand.trim().toLowerCase();
  if (!isBrandHex(candidate)) {
    return { ok: false, error: "Use a six-digit hex colour, like #0c3543." };
  }
  const light = DEFAULT_THEME.brandFg; // #ffffff
  const dark = DEFAULT_THEME.accentFg; // #16201f — the dark text token
  const brandFg =
    contrastRatio(candidate, light) >= contrastRatio(candidate, dark) ? light : dark;

  const parsed = themeSchema.safeParse({ ...base, brand: candidate, brandFg });
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "That colour cannot carry readable text. Pick a darker or lighter one.",
    };
  }
  return { ok: true, theme: parsed.data };
}
