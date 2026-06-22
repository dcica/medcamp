-- AlterTable
ALTER TABLE "events" ADD COLUMN     "location" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "externallyHosted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hostedByName" TEXT,
ADD COLUMN     "externalUrl" TEXT;
