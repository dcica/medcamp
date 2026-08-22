-- Migration A — running order + stage state, per-event access, floor capacity.
--
-- ADDITIVE ONLY. Every column here is nullable or defaulted, every table is new,
-- and nothing existing is dropped, retyped or tightened. That is a hard property
-- of this migration, not an accident of what it happened to need: it must be
-- safe to apply BEFORE the deploy that reads any of it, which is this repo's
-- ordering rule after the /register outage on 2026-08-21 (Prisma selects every
-- column, so code deployed ahead of its migration faults with P2022).
--
-- WRITTEN BY HAND, deliberately. `prisma migrate dev` cannot generate this one:
-- it diffs the schema against the database and would additionally DROP
-- service_types.admits and service_types.fulfillable, which the 2026-08-22
-- service-kind migration removed from schema.prisma and left in the database on
-- purpose, so the running app could keep reading them. That drift is intended
-- and stays until no reader references those columns.
--
-- ONE EXCEPTION TO "ADDITIVE" IS DELIBERATELY ABSENT: performance_entries
-- .durationSeconds stays NULLABLE. Making it NOT NULL is a constraint
-- TIGHTENING and must land AFTER the deploy that makes performanceEntrySchema
-- require it — the reverse of the ordering rule above. Tightening first would
-- 500 every live /perform submission in the window in between. Migration B.

-- ── 1. Show night: running order + stage state ───────────────────────────────

CREATE TYPE "StageState" AS ENUM ('WAITING', 'CALLED', 'BACKSTAGE', 'PERFORMING', 'PERFORMED');

ALTER TABLE "performance_entries"
  ADD COLUMN "runningOrder" INTEGER,
  ADD COLUMN "stageState"   "StageState" NOT NULL DEFAULT 'WAITING',
  ADD COLUMN "startedAt"    TIMESTAMP(3),
  ADD COLUMN "finishedAt"   TIMESTAMP(3),
  ADD COLUMN "notes"        TEXT;

-- THE REASON THIS MIGRATION EXISTS RATHER THAN A UI RULE. Two groups holding
-- slot 7 is exactly the failure the paper running order has today, and a
-- drag-to-reorder screen racing itself would reproduce it. NULLs are distinct in
-- Postgres, so any number of not-yet-placed entries coexist happily.
--
-- Consequence for the reorder UI: renumbering must happen in ONE transaction.
-- There is no ordering of single-row UPDATEs that avoids colliding on a swap.
CREATE UNIQUE INDEX "performance_entries_eventId_runningOrder_key"
  ON "performance_entries"("eventId", "runningOrder");

-- ── 2. Floor capacity ────────────────────────────────────────────────────────

-- The denominator of the gate's fill bar. Per-event because every venue has a
-- different floor, and the mandate is configuration over code.
ALTER TABLE "events" ADD COLUMN "venueCapacity" INTEGER;

-- Null means "no stated limit" and is a legitimate answer — the gate then shows
-- a plain headcount with no bar. Zero is not: it would read "312 of 0" and tell
-- the door to stop admitting guests who are already inside. Same rule, same
-- reasoning and the same shape as "service_caps_capacity_positive": enforced
-- where no screen, seed or script can bypass it.
ALTER TABLE "events"
  ADD CONSTRAINT "events_venueCapacity_positive"
  CHECK ("venueCapacity" IS NULL OR "venueCapacity" > 0);

-- ── 3. Coordinator notes about the event ─────────────────────────────────────

-- Venue and logistics only. Deliberately NOT called "notes": performance_entries
-- .notes already exists for a different job.
--
-- The No-PHI rule bites harder here than anywhere else on this table, because
-- events are NEVER PURGED. `purgedAt` erases attendee PII and leaves the event
-- row standing forever, so an attendee detail typed into this box outlives the
-- deletion meant to remove it. The length cap that keeps it a note rather than a
-- roster lives in src/lib/eventSetup.ts, checked on the server, not here — a
-- hard column width would fail a coordinator's save with a Postgres error
-- instead of a sentence they can act on.
ALTER TABLE "events" ADD COLUMN "internalNotes" TEXT;

-- ── 4. Readiness-flag acknowledgement ────────────────────────────────────────

-- NO CODE READS THESE TWO YET. They are batched into this migration on purpose:
-- every migration here needs a gated CI approval that has deadlocked before, so
-- additive nullable columns that are already designed ride along with the
-- migration in flight rather than costing another trip through the gate. The
-- flag-review screen lands later and finds its columns already present. Do not
-- delete them as dead.
ALTER TABLE "events"
  ADD COLUMN "flagsReviewedAt"   TIMESTAMP(3),
  ADD COLUMN "flagsReviewedById" TEXT;

ALTER TABLE "events"
  ADD CONSTRAINT "events_flagsReviewedById_fkey"
  FOREIGN KEY ("flagsReviewedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 5. Per-event role and capability ─────────────────────────────────────────

-- memberships is UNIQUE(orgId, userId): one role per person per org, forever.
-- But till holders are assigned per camp, and the person running a station at
-- the medical camp is not thereby a station volunteer at the Diwali gate. This
-- table is the per-event override; absence of a row means "use the org default".
-- No orgId column — the event owns the tenancy, and a second copy could
-- disagree with it.
CREATE TABLE "event_assignments" (
    "id"                TEXT NOT NULL,
    "eventId"           TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "role"              "Role" NOT NULL,
    "canHoldTill"       BOOLEAN NOT NULL DEFAULT false,
    "canOverrideWaiver" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_assignments_pkey" PRIMARY KEY ("id")
);

-- One assignment per person per event; a second row would be two answers to a
-- question with one answer.
CREATE UNIQUE INDEX "event_assignments_eventId_userId_key"
  ON "event_assignments"("eventId", "userId");

-- "which events am I assigned to" — the unique index above only serves
-- eventId-leading lookups.
CREATE INDEX "event_assignments_userId_idx" ON "event_assignments"("userId");

ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
