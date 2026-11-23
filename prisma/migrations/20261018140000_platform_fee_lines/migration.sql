-- The platform service fee and the buyer's processing-cost cover, as LINE
-- ITEMS: a Checkout carries at most one PLATFORM_FEE line (what Stripe moves
-- to the platform at charge time) and one FEE_COVER line (the organisation's
-- own gross-up), both recomputed from the goods lines every time a session is
-- opened, by ensureFeeLines in src/server/payments.ts and nowhere else.
-- orders.coverProcessingFee is the buyer's tick, persisted so a resume
-- recomputes the same cover; payments.applicationFeeCents is what the session
-- was opened with, read by confirmOrderPaid to book the DEBIT.
--
-- PURELY ADDITIVE: an enum, a nullable column, a defaulted column, a nullable
-- column. Safe to apply BEFORE the deploy that reads it, per the ordering rule
-- the /register outage on 2026-08-21 established. A null feeKind is goods, so
-- every existing line is untouched in meaning.
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- CreateEnum
CREATE TYPE "FeeLineKind" AS ENUM ('PLATFORM_FEE', 'FEE_COVER');

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "feeKind" "FeeLineKind";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coverProcessingFee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "applicationFeeCents" INTEGER;

