-- General-fund donations (plan tasks D0 + D1): an order with NO event.
--
-- orders.eventId becomes nullable — a LOOSENING, the one kind of constraint
-- change that is safe to apply before the deploy that uses it: every existing
-- row keeps its event, every existing query keeps matching, and nothing that
-- reads today can meet a null until the donate page writes one. The FK and
-- its ON DELETE CASCADE are unchanged; a null simply has nothing to cascade
-- from, which is the point: a gift to the organisation outlives every event.
-- honoreeName / donorNote are donor-entered and optional; receiptSentAt
-- records delivery of the receipt email.
--
-- `prisma migrate diff` against the migrated local database produced exactly
-- these statements and nothing else; read before committing, per CLAUDE.md.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "donorNote" TEXT,
ADD COLUMN     "honoreeName" TEXT,
ADD COLUMN     "receiptSentAt" TIMESTAMP(3),
ALTER COLUMN "eventId" DROP NOT NULL;

