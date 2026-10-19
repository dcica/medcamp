-- Bank debits (ACH), plan task P7.
--
-- PaymentStatus gains PROCESSING: a Checkout session that completed UNPAID
-- (a delayed-notification method), whose outcome Stripe reports later as
-- async_payment_succeeded or async_payment_failed. orders.capsReservedAt
-- records that the in-flight debit claimed the order's capacity, so
-- confirmation does not claim it twice and a failed debit gives back exactly
-- what was held. service_caps.onlineMethods lets an offering be card-only or
-- bank-only per event (a $2,000 booth fee pays 0.8% capped at $5 by bank).
--
-- PURELY ADDITIVE: a new enum value, a nullable column, a new enum and a
-- defaulted column. Safe to apply BEFORE the deploy that reads it. Note that
-- Postgres commits a new enum value immediately, and it cannot be used in the
-- same transaction it was added in; migrate deploy runs this file on its own.
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- CreateEnum
CREATE TYPE "OnlineMethods" AS ENUM ('ANY', 'CARD_ONLY', 'ACH_ONLY');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "capsReservedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_caps" ADD COLUMN     "onlineMethods" "OnlineMethods" NOT NULL DEFAULT 'ANY';

