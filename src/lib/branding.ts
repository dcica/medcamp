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
 *
 * THIS CHECK IS ENVIRONMENT-DEPENDENT, and that has a consequence which cost a
 * data-loss bug: the answer changes when NEXT_PUBLIC_SUPABASE_URL changes. So it
 * runs ONLY on the render path, where the failure mode is "the logo falls back to
 * /icon.png". It must never decide whether a theme PARSES — see
 * `hasAssetUrlShape` and `readStoredTheme` for why.
 *
 * `prefix` is injectable so the verify suite can exercise the host comparison
 * with a configured host. Without that the local/CI environment (no
 * NEXT_PUBLIC_SUPABASE_URL) short-circuits on the null-prefix guard and the
 * allowlist below is never reached by any test.
 */
export function sanitizeAssetUrl(
  raw: unknown,
  prefix: string | null = supabasePublicObjectPrefix(),
): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_ASSET_URL_LENGTH) return null;

  if (value.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(value) && !value.includes("..") ? value : null;
  }

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

/**
 * HOST-INDEPENDENT shape check: a same-origin path, or a syntactically valid
 * absolute https URL with no query or fragment. Says nothing about WHICH host.
 *
 * WHY THIS EXISTS SEPARATELY FROM `sanitizeAssetUrl`. The first version of this
 * module validated asset URLs inside `themeSchema` using the host check. Since
 * that check reads NEXT_PUBLIC_SUPABASE_URL, and since a theme is deliberately
 * all-or-nothing, changing or dropping that env var made the ENTIRE THEME fail
 * to parse: the tenant's palette and wordmark silently reverted to the reference
 * tenant's, and the next colour-only Save from the settings form wrote those
 * defaults back over the tenant's real stored values. Permanent data loss
 * triggered by a config change rather than a deploy — the exact failure class
 * this module exists to prevent.
 *
 * The reasoning that justifies all-or-nothing for colours does not extend to
 * assets. Contrast is a property of a PAIR, so the six colours must arrive
 * together or a pair gets validated against a partner it never ships with. An
 * asset URL has no partner and has a safe per-field fallback (/icon.png), so an
 * unreachable one is a missing logo, never a missing palette.
 *
 * This check is therefore the only one allowed to decide whether a theme parses,
 * and it is stable across every environment: the same string always gives the
 * same answer. The host restriction still applies with full force — it just
 * applies on the render path, where failing means falling back.
 */
export function hasAssetUrlShape(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (!value || value.length > MAX_ASSET_URL_LENGTH) return false;
  if (value.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(value) && !value.includes("..");
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const assetField = z.string().trim().refine(hasAssetUrlShape, {
  message:
    "A logo must be a path on this site (like /icon.png) or an https URL with no query string.",
});

/**
 * Write-time host check for an asset URL a HUMAN just submitted, for the step-4
 * upload slots. Returns an error message or null.
 *
 * Deliberately separate from `themeSchema`: refusing a wrong-host URL the moment
 * a coordinator types it is good, but the same refusal applied to a value already
 * IN the database is the data-loss bug described on `hasAssetUrlShape`. The
 * difference is that this runs against a live form submission in the current
 * environment, where "the configured host" is a fact the user can see and act on.
 */
export function assetUrlWriteError(raw: unknown): string | null {
  if (!hasAssetUrlShape(raw)) {
    return "A logo must be a path on this site (like /icon.png) or an https URL with no query string.";
  }
  if (sanitizeAssetUrl(raw) === null) {
    return "That logo is not on this site or in this deployment's configured storage bucket, so it would not load.";
  }
  return null;
}

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
    /**
     * Square logo, rendered round-cropped at 28px in the header.
     *
     * RAW AS STORED — shape-checked only, NOT host-checked (see
     * hasAssetUrlShape). Never render this field directly: use
     * `Branding.markUrl`, which is the host-checked, fallback-applied value.
     * It is kept raw here so that a host change cannot destroy it on the next
     * save; the render path is what decides whether it is usable today.
     */
    markUrl: assetField.optional(),
    /**
     * Horizontal lockup for badges, certificates and email — never the app bar.
     * Same caveat as markUrl: raw as stored, use `Branding.lockupUrl` to render.
     */
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

/**
 * What the `theme` key in a settings blob actually turned out to be.
 *
 * The three cases have to be distinguishable because they demand OPPOSITE
 * behaviour on the write path. Rendering treats "absent" and "unreadable"
 * identically — both fall back to the app defaults, which is always safe. Saving
 * must not: composing a new theme on top of the defaults is correct when the
 * tenant genuinely has no theme, and is silent data destruction when they have
 * one that could not be parsed. "I could not read your theme" must never mean
 * "so I overwrote it".
 */
export type StoredTheme =
  /** No `theme` key at all — a fresh tenant, or a legacy `{brand, locale}` row. */
  | { kind: "none" }
  /** Parsed and validated. */
  | { kind: "ok"; theme: Theme }
  /** A `theme` key is present but did not parse. Render defaults; refuse to overwrite. */
  | { kind: "unreadable"; reason: string };

/**
 * Read and classify the stored theme. Total — never throws, for any input.
 *
 * The try/catch is not decoration: this runs in the ROOT LAYOUT on every
 * request, so anything thrown here is a site-wide 500 caused by one malformed
 * JSON column, including on /login, the page you would need to reach the
 * settings form and fix the column.
 */
export function readStoredTheme(settings: unknown): StoredTheme {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).theme
      : undefined;

  if (raw === undefined || raw === null) return { kind: "none" };

  try {
    const parsed = themeSchema.safeParse(raw);
    if (parsed.success) return { kind: "ok", theme: parsed.data };
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return {
      kind: "unreadable",
      reason: path ? `${path}: ${issue?.message}` : (issue?.message ?? "invalid theme"),
    };
  } catch (err) {
    return { kind: "unreadable", reason: err instanceof Error ? err.message : "invalid theme" };
  }
}

export type Branding = {
  /** null ⇒ emit nothing; globals.css keeps the app defaults. */
  theme: Theme | null;
  /**
   * The classified read, for callers that WRITE. Rendering wants `theme`; a save
   * path needs to tell "no theme" from "unreadable theme" so it does not
   * overwrite the latter. See StoredTheme.
   */
  storedTheme: StoredTheme;
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
  const storedTheme = readStoredTheme(settings);
  const theme = storedTheme.kind === "ok" ? storedTheme.theme : null;

  const name = typeof orgName === "string" && orgName.trim() ? orgName.trim() : null;

  return {
    theme,
    storedTheme,
    wordmark: theme?.wordmark ?? name ?? FALLBACK_WORDMARK,
    // THE HOST CHECK LIVES HERE, on the render path only. The schema shape-checked
    // the string; this decides whether it is loadable in THIS environment. A
    // no-longer-reachable URL becomes a fallback logo, never a lost palette — and
    // never a lost stored value, because `theme` still carries the raw string for
    // the save path to round-trip.
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
 *
 * IT TAKES A `StoredTheme`, NOT A `Theme | null`, AND THAT IS THE POINT. Given a
 * bare null it could not tell "this tenant has no theme" (compose on the
 * defaults — correct) from "this tenant has a theme I could not parse" (composing
 * on the defaults silently destroys their accent, accent2, wordmark and logos).
 * A one-field colour edit must not be able to erase the rest of the palette, so
 * the unreadable case is REFUSED with a message a human can act on. A readable
 * error always beats a silent overwrite.
 */
export function themeWithBrand(
  current: StoredTheme,
  brand: string,
): { ok: true; theme: Theme } | { ok: false; error: string } {
  if (current.kind === "unreadable") {
    return {
      ok: false,
      error:
        `This organization's saved theme could not be read (${current.reason}), so saving would ` +
        `overwrite it. Fix or clear the stored theme before changing colours here.`,
    };
  }
  const base = current.kind === "ok" ? current.theme : DEFAULT_THEME;
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
