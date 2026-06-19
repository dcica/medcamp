-- CreateEnum
CREATE TYPE "ChecklistPhase" AS ENUM ('PRE_CAMP', 'DAY_OF', 'DURING', 'POST_CAMP');

-- CreateEnum
CREATE TYPE "ChecklistCategory" AS ENUM ('SIGNAGE', 'SUPPLIES', 'TECH', 'LOGISTICS', 'SYSTEM');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "walkInOpensAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "canOverrideWaiver" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "colorHex" TEXT;

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "phase" "ChecklistPhase" NOT NULL,
    "category" "ChecklistCategory" NOT NULL DEFAULT 'LOGISTICS',
    "description" TEXT NOT NULL,
    "assignedRole" "Role",
    "printArtifact" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "status" "VisitStatus" NOT NULL DEFAULT 'QUEUED',
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "canHoldTill" BOOLEAN NOT NULL DEFAULT false,
    "canOverrideWaiver" BOOLEAN NOT NULL DEFAULT false,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_items_eventId_phase_idx" ON "checklist_items"("eventId", "phase");

-- CreateIndex
CREATE INDEX "invites_orgId_idx" ON "invites"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_orgId_email_key" ON "invites"("orgId", "email");

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
