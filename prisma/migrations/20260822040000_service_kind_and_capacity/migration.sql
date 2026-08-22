-- Service kind becomes ONE value, and capacity 0 becomes unstorable.
--
-- WHY: `admits` + `fulfillable` were independent booleans expressing a
-- three-way choice, so nonsense combinations were storable and only convention
-- prevented them — the seed literally warns that the pair is "a correctness
-- invariant, not a coordinator preference". Meanwhile `capacity = 0` on an
-- OFFERED service takes the buyer's money and then fails confirmation, because
-- confirmOrder gates on `sold <= capacity - qty` → `0 <= -1`. That state was
-- live on the Diwali festival's competition entry.
--
-- This migration must land BEFORE the app deploy that reads `kind`. Prisma
-- selects every column by default, so code deployed ahead of its migration
-- faults with P2022 — exactly the /register outage on 2026-08-21.

-- ── 1. Kind ──────────────────────────────────────────────────────────────────
CREATE TYPE "ServiceKind" AS ENUM ('ADMISSION', 'MERCH', 'FEE');

-- Refuse to run if the invalid pair exists anywhere. It should not: admits AND
-- fulfillable together has no meaning, and it is empty on test and prod as of
-- 2026-08-22. Better to abort than to silently pick a kind for it.
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM "service_types" WHERE "admits" AND "fulfillable";
  IF bad > 0 THEN
    RAISE EXCEPTION 'Cannot derive kind: % service_types have admits AND fulfillable set', bad;
  END IF;
END $$;

ALTER TABLE "service_types" ADD COLUMN "kind" "ServiceKind";

UPDATE "service_types" SET "kind" =
  CASE
    WHEN "fulfillable" THEN 'MERCH'::"ServiceKind"
    WHEN "admits"      THEN 'ADMISSION'::"ServiceKind"
    ELSE 'FEE'::"ServiceKind"
  END;

ALTER TABLE "service_types" ALTER COLUMN "kind" SET NOT NULL;

-- `admits` / `fulfillable` are deliberately NOT dropped here. Dropping them in
-- the same migration would break the currently-running app the instant this
-- applies, since it still reads them. A later migration removes them once no
-- reader references them.

-- ── 2. Capacity ──────────────────────────────────────────────────────────────
ALTER TABLE "service_caps" ALTER COLUMN "capacity" DROP NOT NULL;

-- Existing zeros are resolved, not carried forward. 0 never meant "no limit" —
-- it meant "cannot sell", and on an offered service it meant "charge, then
-- fail". Rows that have sold nothing become uncapped (NULL), which is at least
-- sellable; the readiness flags then prompt a coordinator to set a real figure.
-- A row that has SOLD against a 0 capacity would be contradictory, so it is left
-- alone and will surface as a flag rather than being silently rewritten.
UPDATE "service_caps" SET "capacity" = NULL WHERE "capacity" = 0 AND "sold" = 0;

-- The rule, enforced where it cannot be bypassed by a screen, a seed or a script.
ALTER TABLE "service_caps"
  ADD CONSTRAINT "service_caps_capacity_positive"
  CHECK ("capacity" IS NULL OR "capacity" > 0);
