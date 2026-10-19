"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";
import { readStoredTheme, themeWithBrand } from "@/lib/branding";
import { PROFILE_LABELS, donationsSchema, legalSchema, paymentsSchema, profileSchema, siteSchema } from "@/lib/orgSettings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Save the org name and brand colour.
 *
 * WHAT CHANGED AND WHY. This action used to write `input.brand` straight into a
 * top-level `settings.brand` key with no validation at all — any string, stored
 * verbatim. Nothing read it back, so the control was inert. Now that the layout
 * emits the palette, two things had to be true at once: the coordinator's one
 * visible colour field must actually work, and the value must be safe to
 * interpolate into a style attribute.
 *
 * So the field writes the NEW namespaced shape (`settings.theme`), through
 * `themeWithBrand`, which fills in a readable foreground and validates the whole
 * pair set — including the contrast check — before anything is stored. An
 * unreadable colour is refused here rather than shipped to a volunteer's screen.
 *
 * The legacy top-level `brand` key is left exactly where it is: untouched and
 * unread. Deleting it would be a data migration racing three deployments for no
 * gain, and rewriting it would recreate the very disagreement this design
 * removes. It is inert history now.
 */
export async function updateOrgSettings(input: {
  name: string;
  brand: string;
}): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  // readStoredTheme, not resolveBranding: this is a WRITE, and it must be able to
  // tell "no theme" from "a theme I could not parse". Handing themeWithBrand a
  // bare null for both would let a one-colour edit silently overwrite a tenant's
  // whole palette with the reference tenant's defaults — see StoredTheme.
  const stored = readStoredTheme(org.settings);
  const next = themeWithBrand(stored, input.brand, name);
  if (!next.ok) return { ok: false, error: next.error };

  const settings = {
    ...(org.settings as Record<string, unknown>),
    theme: next.theme,
  };

  await db.organization.update({
    where: { id: org.id },
    data: { name, settings },
  });
  revalidatePath("/admin/settings");
  // The palette is emitted by the ROOT layout, so a theme change invalidates
  // every route, not just this one. 37 of 38 pages are force-dynamic anyway;
  // /403 is the one that would otherwise keep a stale header.
  revalidatePath("/", "layout");
  return { ok: true };
}

export type ProfileInput = {
  contactEmail: string;
  senderEmail: string;
  legalName: string;
  ein: string;
  taxStatus: "" | "501c3" | "governmental" | "other";
  receiptStatement: string;
};

/**
 * Save the organisation's profile. A blank field clears it; anything else
 * must pass the SAME schema the render path applies (orgSettings.ts), so a
 * value that would be dropped on read is refused on write with a reason.
 * Replaces exactly the `profile` key: a brand save and a profile save can
 * never clobber each other.
 */
export async function updateOrgProfile(input: ProfileInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const profile: Record<string, string> = {};
  for (const [key, schema] of Object.entries(profileSchema.shape)) {
    const raw = ((input as Record<string, string>)[key] ?? "").trim();
    if (!raw) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: `${PROFILE_LABELS[key as keyof typeof PROFILE_LABELS]}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      };
    }
    profile[key] = parsed.data as string;
  }

  const settings = {
    ...(org.settings as Record<string, unknown>),
    profile,
  };
  await db.organization.update({ where: { id: org.id }, data: { settings } });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export type SiteInput = {
  gaMeasurementId: string;
  gaApiSecret: string;
  googleSiteVerification: string;
};

/** Save the organisation's analytics and search settings; a blank clears a field. Replaces exactly the `site` key. */
export async function updateOrgSite(input: SiteInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const site: Record<string, string> = {};
  const labels: Record<string, string> = {
    gaMeasurementId: "Measurement id",
    gaApiSecret: "API secret",
    googleSiteVerification: "Verification token",
  };
  for (const [key, schema] of Object.entries(siteSchema.shape)) {
    const raw = ((input as Record<string, string>)[key] ?? "").trim();
    if (!raw) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `${labels[key]}: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    }
    site[key] = parsed.data as string;
  }

  const settings = {
    ...(org.settings as Record<string, unknown>),
    site,
  };
  await db.organization.update({ where: { id: org.id }, data: { settings } });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export type DonationsInput = {
  enabled: boolean;
  /** Dollars, comma-separated, as typed. */
  suggestedAmounts: string;
  /** Dollars, as typed. */
  minDollars: string;
  allowFeeCover: boolean;
};

/** Dollars as typed → whole cents, or null when it is not a usable amount. */
function dollarsToCentsOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export async function updateOrgDonations(input: DonationsInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const amounts = input.suggestedAmounts
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(dollarsToCentsOrNull);
  if (amounts.some((a) => a === null)) {
    return { ok: false, error: "Suggested amounts: dollars, separated by commas (e.g. 25, 50, 100)." };
  }
  const minCents = dollarsToCentsOrNull(input.minDollars);
  if (minCents === null) return { ok: false, error: "Minimum gift: a dollar amount (e.g. 5)." };

  const parsed = donationsSchema.safeParse({
    enabled: Boolean(input.enabled),
    suggestedAmountsCents: amounts,
    allowFeeCover: Boolean(input.allowFeeCover),
    minCents,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") || "donations"}: ${issue?.message ?? "invalid"}` };
  }

  const settings = {
    ...(org.settings as Record<string, unknown>),
    donations: parsed.data,
  };
  await db.organization.update({ where: { id: org.id }, data: { settings } });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  revalidatePath("/donate");
  return { ok: true };
}

export type PaymentsInput = {
  achEnabled: boolean;
  /** Business days before an event's start after which bank debits are off. */
  cutoffBusinessDays: string;
  /** Dollars; blank = no threshold. Orders over it are bank-only. */
  achOnlyAboveDollars: string;
};

export async function updateOrgPayments(input: PaymentsInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };
  const cutoff = input.cutoffBusinessDays.trim();
  if (!/^\d{1,2}$/.test(cutoff)) return { ok: false, error: "Cutoff: a whole number of business days (0–30)." };
  const above = input.achOnlyAboveDollars.trim();
  const aboveCents = above === "" ? null : dollarsToCentsOrNull(above);
  if (above !== "" && aboveCents === null) return { ok: false, error: "Bank-only above: a dollar amount, or blank." };
  const parsed = paymentsSchema.safeParse({
    ach: {
      enabled: Boolean(input.achEnabled),
      cutoffBusinessDays: Number(cutoff),
      verification: "instant",
      achOnlyAboveCents: aboveCents,
    },
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") || "payments"}: ${issue?.message ?? "invalid"}` };
  }
  const settings = {
    ...(org.settings as Record<string, unknown>),
    payments: parsed.data,
  };
  await db.organization.update({ where: { id: org.id }, data: { settings } });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export type LegalInput = { privacy: string; terms: string };

/** Save the organisation's privacy policy and terms text; a blank unpublishes. Replaces exactly the `legal` key. */
export async function updateOrgLegal(input: LegalInput): Promise<ActionResult> {
  await requireCoordinator();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const legal: Record<string, string> = {};
  for (const [key, schema] of Object.entries(legalSchema.shape)) {
    const raw = ((input as Record<string, string>)[key] ?? "").trim();
    if (!raw) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `${key === "privacy" ? "Privacy policy" : "Terms"}: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    }
    legal[key] = parsed.data as string;
  }

  const settings = {
    ...(org.settings as Record<string, unknown>),
    legal,
  };
  await db.organization.update({ where: { id: org.id }, data: { settings } });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  revalidatePath("/privacy");
  revalidatePath("/terms");
  return { ok: true };
}
