-- Index every foreign key. Postgres indexes the PARENT side of a reference
-- automatically (the primary key) but never the child side, so each of these
-- columns was a sequential scan away from any traversal or FK check. Supabase's
-- performance advisor flagged all 13, once per schema.
--
-- Two are load-bearing today:
--   attendees.orderId       — the Stripe webhook reads order.attendees on every
--                             confirmation (src/server/payments.ts), as do the
--                             gate and the confirmation page.
--   service_caps.serviceTypeId — _count on ServiceType, admin services page.
--
-- The rest are prophylactic: no query traverses them yet, but they sit on
-- SetNull/Cascade edges, which means any future parent delete would scan the
-- whole child table to enforce the constraint. These tables are all low-write
-- (hundreds to low thousands of rows), so the insert cost is immaterial and the
-- advisor stays at zero — which keeps it useful as a signal.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma wraps migrations in a
-- transaction, which forbids CONCURRENTLY, and at these row counts the lock is
-- held for microseconds.

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "attendees_orderId_idx" ON "attendees"("orderId");

-- CreateIndex
CREATE INDEX "checklist_items_orgId_idx" ON "checklist_items"("orgId");

-- CreateIndex
CREATE INDEX "ledger_entries_paymentId_idx" ON "ledger_entries"("paymentId");

-- CreateIndex
CREATE INDEX "ledger_entries_lineItemId_idx" ON "ledger_entries"("lineItemId");

-- CreateIndex
CREATE INDEX "line_items_serviceTypeId_idx" ON "line_items"("serviceTypeId");

-- CreateIndex
CREATE INDEX "line_items_membershipPlanId_idx" ON "line_items"("membershipPlanId");

-- CreateIndex
CREATE INDEX "members_planId_idx" ON "members"("planId");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE INDEX "service_caps_serviceTypeId_idx" ON "service_caps"("serviceTypeId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "stations_orgId_idx" ON "stations"("orgId");

-- CreateIndex
CREATE INDEX "volunteer_signups_counselorId_idx" ON "volunteer_signups"("counselorId");

