-- AlterTable
ALTER TABLE "events" ADD COLUMN     "honorsMembership" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "membershipPlanId" TEXT;

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "termYears" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "partySize" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "planId" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 4,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_plans_orgId_idx" ON "membership_plans"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_orgId_key_key" ON "membership_plans"("orgId", "key");

-- CreateIndex
CREATE INDEX "members_orgId_idx" ON "members"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "members_orgId_email_key" ON "members"("orgId", "email");

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
