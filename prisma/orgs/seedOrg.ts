import type { Prisma, PrismaClient } from "@prisma/client";
import { themeSchema } from "../../src/lib/branding";
import { normalizeHost } from "../../src/lib/tenantResolve";
import type { OrgSeed, SeedEnv } from "./types";

/**
 * Provision one organisation from its module. Idempotent: every write is an
 * upsert keyed on the organisation's natural keys, so CI can run it on every
 * push. The organisation row itself is `update: {}` — seeding never renames
 * an existing organisation; a rename is a deliberate manual write.
 *
 * The theme is validated HERE, with the same schema the layout uses, so a
 * bad palette fails the seed with a readable message instead of failing the
 * first page render for everyone.
 */
export async function seedOrg(db: PrismaClient, seed: OrgSeed, env: SeedEnv) {
  const theme = themeSchema.safeParse(seed.settings.theme);
  if (!theme.success) {
    throw new Error(`${seed.slug}: theme is invalid — ${theme.error.issues.map((i) => i.message).join("; ")}`);
  }

  const org = await db.organization.upsert({
    where: { slug: seed.slug },
    update: {},
    create: { slug: seed.slug, name: seed.name, settings: seed.settings as Prisma.InputJsonValue },
  });

  for (const s of seed.services) {
    await db.serviceType.upsert({
      where: { orgId_key: { orgId: org.id, key: s.key } },
      update: {
        name: s.name,
        priceCents: s.priceCents,
        ...(s.colorHex !== undefined ? { colorHex: s.colorHex } : {}),
        ...(s.hasLab !== undefined ? { hasLab: s.hasLab } : {}),
        ...(s.admitsCount !== undefined ? { admitsCount: s.admitsCount } : {}),
      },
      create: { orgId: org.id, ...s },
    });
  }

  for (const p of seed.membershipPlans) {
    await db.membershipPlan.upsert({
      where: { orgId_key: { orgId: org.id, key: p.key } },
      update: { name: p.name, termYears: p.termYears, priceCents: p.priceCents, partySize: p.partySize },
      create: { orgId: org.id, ...p },
    });
  }

  // Hostnames are a fact about THIS deployment environment. Stored normalised
  // (the resolver compares normalised request hosts); the first is primary.
  const hosts = seed.domains[env] ?? [];
  for (const [i, raw] of hosts.entries()) {
    const hostname = normalizeHost(raw);
    if (!hostname) throw new Error(`${seed.slug}: unusable hostname ${JSON.stringify(raw)}`);
    await db.orgDomain.upsert({
      where: { hostname },
      update: { orgId: org.id, isPrimary: i === 0 },
      create: { orgId: org.id, hostname, isPrimary: i === 0 },
    });
  }

  for (const inv of seed.invites) {
    await db.invite.upsert({
      where: { orgId_email: { orgId: org.id, email: inv.email } },
      update: {},
      create: { orgId: org.id, email: inv.email, role: inv.role },
    });
  }

  return org;
}
