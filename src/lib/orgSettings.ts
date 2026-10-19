import { z } from "zod";
import { GA_MEASUREMENT_ID_RE } from "@/lib/env";

/**
 * Per-organisation settings that used to be one tenant's literals: who to
 * contact, who mail comes from, the legal identity receipts carry, and the
 * analytics ids. Stored under `Organization.settings.profile` / `.site`, and
 * — like the theme in branding.ts — validated on WRITE (the admin action) and
 * again on READ, because `settings` is arbitrary JSON and a value nobody
 * validated is a value an attacker chose.
 *
 * Resolution is field by field and total: a bad EIN costs the EIN, not the
 * contact address next to it, and nothing here ever throws on the render path.
 */

const NO_HEADER_BREAKS = /^[^\r\n]*$/;
const address = z.string().trim().email().max(200);

/** `Name <addr>` or a bare address. No line breaks — it becomes a mail header. */
const displayAddress = z
  .string()
  .trim()
  .max(200)
  .regex(NO_HEADER_BREAKS, "No line breaks")
  .refine(
    (s) => address.safeParse(s).success || /^[^<>]*<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(s),
    "Use an address, or Name <address>",
  );

export const profileSchema = z.object({
  /** Public contact: footer link, enquiry pages, JSON-LD, Reply-To on mail. */
  contactEmail: address,
  /** The From address mail is sent as; must be a verified identity at the provider. */
  senderEmail: displayAddress,
  /** As it must appear on a donation receipt. */
  legalName: z.string().trim().min(1).max(200),
  ein: z.string().trim().regex(/^\d{2}-\d{7}$/, "An EIN looks like 12-3456789"),
  /** The organisation's own assertion; the platform never writes this. */
  taxStatus: z.enum(["501c3", "governmental", "other"]),
  /** The organisation's own receipt sentence, in its own words. */
  receiptStatement: z.string().trim().min(1).max(600),
});

export const siteSchema = z.object({
  gaMeasurementId: z.string().trim().regex(GA_MEASUREMENT_ID_RE, "A GA4 id looks like G-XXXXXXXXXX"),
  gaApiSecret: z.string().trim().min(8).max(200),
  googleSiteVerification: z.string().trim().min(8).max(200),
});

type Nullable<T> = { [K in keyof T]: T[K] | null };
export type OrgProfile = Nullable<z.infer<typeof profileSchema>>;
export type OrgSite = Nullable<z.infer<typeof siteSchema>>;

export const PROFILE_LABELS: Record<keyof OrgProfile, string> = {
  contactEmail: "Contact email",
  senderEmail: "Sender address",
  legalName: "Legal name",
  ein: "EIN",
  taxStatus: "Tax status",
  receiptStatement: "Receipt statement",
};

function blob(settings: unknown, key: string): Record<string, unknown> | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const raw = (settings as Record<string, unknown>)[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function resolveEach<S extends z.ZodRawShape>(
  shape: S,
  raw: Record<string, unknown> | null,
): Nullable<z.infer<z.ZodObject<S>>> {
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const parsed = raw ? schema.safeParse(raw[key]) : null;
    out[key] = parsed?.success ? parsed.data : null;
  }
  return out as Nullable<z.infer<z.ZodObject<S>>>;
}

export function resolveOrgProfile(settings: unknown): OrgProfile {
  return resolveEach(profileSchema.shape, blob(settings, "profile"));
}

export function resolveOrgSite(settings: unknown): OrgSite {
  return resolveEach(siteSchema.shape, blob(settings, "site"));
}

/** The organisation's own sender, else the deployment's EMAIL_FROM. */
export function senderFor(profile: { senderEmail: string | null }, fallback: string): string {
  return profile.senderEmail ?? fallback;
}

/** The organisation's own privacy policy and terms (plain text; see src/lib/legalText.ts). */
export const legalSchema = z.object({
  privacy: z.string().trim().min(1).max(20_000),
  terms: z.string().trim().min(1).max(20_000),
});
export type OrgLegal = Nullable<z.infer<typeof legalSchema>>;

export function resolveOrgLegal(settings: unknown): OrgLegal {
  return resolveEach(legalSchema.shape, blob(settings, "legal"));
}

/**
 * The organisation's donations door (`settings.donations`). OFF until the
 * organisation turns it on; every entry point (/donate, the footer, the
 * empty calendar, the home rail) reads this one flag. Unlike the profile,
 * this resolves to a complete policy — a missing or hostile field is the
 * default, never null — because the donate page needs every value to render.
 */
export const donationsSchema = z.object({
  enabled: z.boolean(),
  /** Whole-cent amounts offered as one-tap buttons; the donor may type any other. */
  suggestedAmountsCents: z.array(z.number().int().min(100).max(10_000_000)).min(1).max(8),
  /** Whether the "cover the processing cost" box is offered on a gift. */
  allowFeeCover: z.boolean(),
  minCents: z.number().int().min(100).max(10_000_000),
});
export type OrgDonations = z.infer<typeof donationsSchema>;

export const DEFAULT_DONATIONS: OrgDonations = {
  enabled: false,
  suggestedAmountsCents: [2500, 5000, 10000, 25000],
  allowFeeCover: true,
  minCents: 100,
};

export function resolveOrgDonations(settings: unknown): OrgDonations {
  const raw = blob(settings, "donations");
  const out: OrgDonations = { ...DEFAULT_DONATIONS };
  if (!raw) return out;
  for (const key of Object.keys(donationsSchema.shape) as (keyof OrgDonations)[]) {
    const parsed = donationsSchema.shape[key].safeParse(raw[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}
