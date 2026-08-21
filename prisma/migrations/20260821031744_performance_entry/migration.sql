-- CreateEnum
CREATE TYPE "SongDelivery" AS ENUM ('UPLOAD', 'OFFLINE');

-- AlterTable
ALTER TABLE "service_caps" ADD COLUMN     "maxDurationSeconds" INTEGER,
ADD COLUMN     "maxParticipants" INTEGER,
ADD COLUMN     "minDurationSeconds" INTEGER,
ADD COLUMN     "minParticipants" INTEGER;

-- CreateTable
CREATE TABLE "performance_entries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "groupName" TEXT NOT NULL,
    "choreographerName" TEXT NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "ageRange" TEXT NOT NULL,
    "songTitle" TEXT NOT NULL,
    "songDelivery" "SongDelivery" NOT NULL,
    "songObjectPath" TEXT,
    "songReadyAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "usesProps" BOOLEAN,
    "needsStagePrep" BOOLEAN,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_entries_orderId_key" ON "performance_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_entries_lineItemId_key" ON "performance_entries"("lineItemId");

-- CreateIndex
CREATE INDEX "performance_entries_orgId_idx" ON "performance_entries"("orgId");

-- CreateIndex
CREATE INDEX "performance_entries_eventId_idx" ON "performance_entries"("eventId");

-- AddForeignKey
ALTER TABLE "performance_entries" ADD CONSTRAINT "performance_entries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_entries" ADD CONSTRAINT "performance_entries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_entries" ADD CONSTRAINT "performance_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_entries" ADD CONSTRAINT "performance_entries_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
