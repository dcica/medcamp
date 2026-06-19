-- AlterTable
ALTER TABLE "attendees" ALTER COLUMN "campId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "nextCampSeq" INTEGER NOT NULL DEFAULT 1;
