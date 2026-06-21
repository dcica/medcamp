-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'COMP';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "offersRegistration" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offersVendors" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offersVolunteers" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "fulfilledByUserId" TEXT;

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN     "fulfillable" BOOLEAN NOT NULL DEFAULT false;

