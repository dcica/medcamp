-- CreateEnum
CREATE TYPE "VolunteerAgeBand" AS ENUM ('UNDER_16', 'AGE_16_17', 'AGE_18_PLUS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SignupStatus" ADD VALUE 'WAITLISTED';
ALTER TYPE "SignupStatus" ADD VALUE 'CANCELLED';

-- DropIndex
DROP INDEX "volunteer_signups_volunteerId_roleId_key";

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "nextVolSeq" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "volunteer_roles" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "linkedStationKey" TEXT,
ADD COLUMN     "minAge" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requiresClearance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shift" TEXT,
ALTER COLUMN "eventId" SET NOT NULL;

-- AlterTable
ALTER TABLE "volunteer_signups" ADD COLUMN     "certificateIssuedAt" TIMESTAMP(3),
ADD COLUMN     "code" TEXT,
ADD COLUMN     "counselorId" TEXT,
ADD COLUMN     "eventId" TEXT NOT NULL,
ADD COLUMN     "feedbackScore" INTEGER,
ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "guardianSignedAt" TIMESTAMP(3),
ADD COLUMN     "hoursServed" DOUBLE PRECISION,
ADD COLUMN     "shift" TEXT,
ADD COLUMN     "sourceTag" TEXT;

-- AlterTable
ALTER TABLE "volunteers" ADD COLUMN     "ageBand" "VolunteerAgeBand",
ADD COLUMN     "emergencyName" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "languages" TEXT,
ADD COLUMN     "school" TEXT,
ADD COLUMN     "skills" TEXT,
ADD COLUMN     "tshirtSize" TEXT;

-- CreateTable
CREATE TABLE "counselors" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "school" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counselors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counselors_orgId_idx" ON "counselors"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "counselors_orgId_email_key" ON "counselors"("orgId", "email");

-- CreateIndex
CREATE INDEX "volunteer_roles_eventId_idx" ON "volunteer_roles"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "volunteer_roles_eventId_key_key" ON "volunteer_roles"("eventId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "volunteer_signups_code_key" ON "volunteer_signups"("code");

-- CreateIndex
CREATE INDEX "volunteer_signups_eventId_status_idx" ON "volunteer_signups"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "volunteer_signups_volunteerId_eventId_key" ON "volunteer_signups"("volunteerId", "eventId");

-- AddForeignKey
ALTER TABLE "counselors" ADD CONSTRAINT "counselors_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_signups" ADD CONSTRAINT "volunteer_signups_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_signups" ADD CONSTRAINT "volunteer_signups_counselorId_fkey" FOREIGN KEY ("counselorId") REFERENCES "counselors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
