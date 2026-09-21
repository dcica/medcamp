-- Keep server errors where they can still be read tomorrow.
--
-- Vercel retains runtime logs for about two hours on this plan. An event ends
-- at 10pm and the first "what happened at the gate?" arrives the next morning,
-- by which point the only record is gone. This is the smallest table that
-- survives the night.
--
-- PURELY ADDITIVE: one new table, nothing altered, nothing dropped. Safe to
-- apply BEFORE the deploy that reads it, which is the ordering rule that the
-- /register outage on 2026-08-21 established -- Prisma SELECTs every declared
-- column, so code deployed ahead of its migration faults with P2022.
--
-- `orgId` is a plain nullable column, NOT a foreign key, following the
-- Order.gaClientId precedent. An error must be recordable before a tenant is
-- resolved (env validation, the health check, middleware) and must outlive the
-- org it mentions; a cascade here would delete the evidence along with the
-- thing being investigated. It still gets an index, because the admin view
-- filters on it.
--
-- `prisma migrate diff` produced exactly this and nothing else -- no unrelated
-- DROP rode along, unlike 20260825120000_order_ga_client_id, which had to be
-- hand-trimmed. Verified by reading the generated script before committing it.
-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "stack" TEXT,
    "fields" JSONB,
    "route" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_logs_createdAt_idx" ON "error_logs"("createdAt");

-- CreateIndex
CREATE INDEX "error_logs_fingerprint_createdAt_idx" ON "error_logs"("fingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "error_logs_orgId_idx" ON "error_logs"("orgId");
