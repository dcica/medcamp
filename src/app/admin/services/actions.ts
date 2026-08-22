"use server";

import { revalidatePath } from "next/cache";
import type { ServiceKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { requireAdmin } from "@/server/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The org-wide identity of a service. Price, capacity and event-specific rules
 * are NOT here — they live on each event's offering, so the same service can be
 * $25 at one event and $12 at another without two catalogue entries.
 */
type CatalogueInput = {
  name: string;
  colorHex: string;
  kind: ServiceKind;
  /** People admitted per unit. Only meaningful for ADMISSION. */
  admitsCount: number;
  hasLab: boolean;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A head count only describes something for an admission — merchandise and a
 * fee admit nobody — so it is pinned to 1 elsewhere rather than left holding a
 * stale number that would start counting heads if the kind ever changed back.
 */
function normalizeAdmitsCount(kind: ServiceKind, raw: number): number {
  if (kind !== "ADMISSION") return 1;
  return Math.max(1, Math.round(Number.isNaN(raw) ? 1 : raw));
}

function validate(input: CatalogueInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!slugify(input.name)) return "Name must contain letters or numbers.";
  if (!/^#[0-9a-fA-F]{6}$/.test(input.colorHex)) return "Colour must be a hex value.";
  return null;
}

export async function createCatalogueService(
  input: CatalogueInput,
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const key = slugify(input.name);
  const exists = await db.serviceType.findUnique({
    where: { orgId_key: { orgId: org.id, key } },
    select: { name: true },
  });
  if (exists) return { ok: false, error: `"${exists.name}" already exists in the catalogue.` };

  await db.serviceType.create({
    data: {
      orgId: org.id,
      key,
      name: input.name.trim(),
      colorHex: input.colorHex,
      kind: input.kind,
      admitsCount: normalizeAdmitsCount(input.kind, input.admitsCount),
      hasLab: input.hasLab,
    },
  });
  revalidatePath("/admin/services");
  return { ok: true };
}

/**
 * Every field written here changes the service at EVERY event that offers it,
 * past and future. That is why this screen exists separately from an event's
 * own services screen, where the same edit looked local.
 *
 * `key` is deliberately not recomputed on rename: it is the stable identifier
 * the registration form and the gate match on.
 */
export async function updateCatalogueService(
  id: string,
  input: CatalogueInput & { active: boolean },
): Promise<ActionResult> {
  await requireAdmin();
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: "No active org." };

  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  const service = await db.serviceType.findFirst({
    where: { id, orgId: org.id },
    select: { id: true },
  });
  if (!service) return { ok: false, error: "Service not found." };

  await db.serviceType.update({
    where: { id },
    data: {
      name: input.name.trim(),
      colorHex: input.colorHex,
      kind: input.kind,
      admitsCount: normalizeAdmitsCount(input.kind, input.admitsCount),
      hasLab: input.hasLab,
      active: input.active,
    },
  });
  revalidatePath("/admin/services");
  return { ok: true };
}
