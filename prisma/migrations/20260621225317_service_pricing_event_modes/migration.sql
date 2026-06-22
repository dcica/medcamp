-- AlterTable
ALTER TABLE "events" ADD COLUMN     "allowsRefunds" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collectsAttendeeDetails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "acceptsDonations" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isDonation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_caps" ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill: seed each per-event offering price from the catalogue default price.
UPDATE "service_caps" sc
SET "priceCents" = st."priceCents"
FROM "service_types" st
WHERE sc."serviceTypeId" = st."id";

-- Backfill: only CAMP events collect a per-attendee (patient) profile; existing
-- non-camp events become quantity-mode (anonymous scannable tickets).
UPDATE "events" SET "collectsAttendeeDetails" = ("type" = 'CAMP');
