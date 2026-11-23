-- Let a coordinator pin an event's position on the public home page.
--
-- The list is ordered by startsAt, which is right almost always and wrong on
-- one night a year: Rhythm of Navratri starts at 5pm and Dandiya Night at 7pm
-- the SAME evening, so date order puts the competition-entry page above the
-- ticket most visitors came to buy. Editing the times is not an option --
-- RON's are the flyer's, and prisma/seed-events.ts says so.
--
-- NULLABLE WITH NO BACKFILL, so null keeps meaning "chronological" and every
-- existing event behaves exactly as it did before this was applied.
--
-- PURELY ADDITIVE: one column, nothing altered, nothing dropped. Safe to
-- apply BEFORE the deploy that reads it, which is the ordering rule the
-- /register outage on 2026-08-21 established -- Prisma SELECTs every declared
-- column, so code shipped ahead of its migration faults with P2022.
--
-- `prisma migrate diff` produced exactly this one statement and nothing else;
-- read before committing, per CLAUDE.md.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "displayOrder" INTEGER;

