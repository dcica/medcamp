-- Named entrants and the fair-market-value snapshot (plan tasks S3 + D3).
--
-- events.namesAttendees: a quantity-mode event may name every admitted head
-- (a tournament entrant, a dinner guest) — a name and nothing else. Still
-- PII, still purged with the event.
-- attendees.lineItemId / seat: which line minted the head and its seat within
-- that line, so a doubles partner is "the other seat in the same unit" with
-- no pairing table. SET NULL on line delete; FK child column indexed per the
-- PR #6 policy (verify:schema).
-- service_caps.fairMarketValueCents: per-unit value the guest RECEIVES (IRS
-- Pub 1771), set per event beside the price. line_items.fairMarketValueCents:
-- the snapshot taken when the line is created, so a receipt re-issued later
-- reads the value that applied when they paid.
--
-- PURELY ADDITIVE: nullable or defaulted columns, one index, one FK. Safe to
-- apply BEFORE the deploy that reads it, per the ordering rule the /register
-- outage on 2026-08-21 established.
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- AlterTable
ALTER TABLE "attendees" ADD COLUMN     "lineItemId" TEXT,
ADD COLUMN     "seat" INTEGER;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "namesAttendees" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "fairMarketValueCents" INTEGER;

-- AlterTable
ALTER TABLE "service_caps" ADD COLUMN     "fairMarketValueCents" INTEGER;

-- CreateIndex
CREATE INDEX "attendees_lineItemId_idx" ON "attendees"("lineItemId");

-- AddForeignKey
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

