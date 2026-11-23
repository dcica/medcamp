-- One shared deployment, many organisations: the Host header must resolve a
-- request to its organisation, and that lookup needs a row per hostname that
-- is unique ACROSS tenants. A hostname list on `organizations` could be
-- claimed by two rows and the resolver would pick whichever came first --
-- the exact "oldest organisation wins" failure this table exists to remove.
--
-- `isPrimary` marks the host every absolute URL for the organisation is built
-- on. One per organisation; Prisma cannot express a partial unique index, so
-- the write path and verify-tenant enforce it.
--
-- PURELY ADDITIVE: one new table, nothing altered, nothing dropped. Nothing
-- reads it until the deploy that follows, so it is safe to apply first -- the
-- ordering rule the /register outage on 2026-08-21 established.
--
-- The orgId index is the FK-child covering index (PR #6 policy, verify:schema).
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- CreateTable
CREATE TABLE "org_domains" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_domains_hostname_key" ON "org_domains"("hostname");

-- CreateIndex
CREATE INDEX "org_domains_orgId_idx" ON "org_domains"("orgId");

-- AddForeignKey
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
