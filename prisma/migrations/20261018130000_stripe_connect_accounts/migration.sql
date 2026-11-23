-- Stripe Connect, Standard accounts, direct charges: the organisation's own
-- Stripe account is where its money lands. The platform's service fee is
-- split off by Stripe at charge time, so nothing here is ever remitted by us.
--
-- null stripeAccountId keeps the platform-key path exactly as it is today
-- (the first tenant's), byte for byte. The four booleans are a snapshot of
-- the connected account's state, written by the onboarding return route and
-- by account.updated on the Connect webhook; a charge is refused in code while
-- onboarding is incomplete. payments.stripeAccountId is denormalised at session
-- creation so a refund or a webhook knows where a charge lives even if the
-- organisation later disconnects.
--
-- PURELY ADDITIVE: nullable or defaulted columns only, nothing altered,
-- nothing dropped. Safe to apply BEFORE the deploy that reads it, per the
-- ordering rule the /register outage on 2026-08-21 established.
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeAchEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeConnectedAt" TIMESTAMP(3),
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "stripeAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeAccountId_key" ON "organizations"("stripeAccountId");

