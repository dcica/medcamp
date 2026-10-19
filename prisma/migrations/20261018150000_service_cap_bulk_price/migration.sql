-- A quantity break on one offering: from "bulkMinQty" units of the SAME
-- service on ONE order line, every unit on that line costs "bulkPriceCents".
-- Diwali 2026's kids carnival sells "4 or more of the same ticket, 20% off"
-- -- rides $10 -> $8, laser tag $10 -> $8, rock wall $5 -> $4. Per line, never
-- cart-wide; src/lib/pricing.ts applies it on both channels and only when it
-- undercuts the phase price, so a cheaper early bird survives it.
--
-- NULLABLE WITH NO BACKFILL, so null keeps meaning "no quantity break" and
-- every existing offering prices exactly as it did before this was applied.
-- Half a rule (one column set, the other null) resolves as absent, which is
-- the early-bird posture; the admin action refuses to write that shape.
--
-- PURELY ADDITIVE: two columns, nothing altered, nothing dropped. Safe to
-- apply BEFORE the deploy that reads it, which is the ordering rule the
-- /register outage on 2026-08-21 established -- Prisma SELECTs every declared
-- column, so code shipped ahead of its migration faults with P2022.
--
-- `prisma migrate diff` produced exactly this one statement and nothing else;
-- read before committing, per CLAUDE.md.

-- AlterTable
ALTER TABLE "service_caps" ADD COLUMN     "bulkMinQty" INTEGER,
ADD COLUMN     "bulkPriceCents" INTEGER;
