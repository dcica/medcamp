"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireCoordinator } from "@/server/admin";
import { resolveBranding, themeWithBrand } from "@/lib/branding";

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

  const current = resolveBranding(org.settings, org.name);
  const next = themeWithBrand(current.theme, input.brand);
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
