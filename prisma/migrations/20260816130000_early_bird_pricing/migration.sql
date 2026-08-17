-- Early-bird pricing: a third price alongside online and door.
--
-- Until now a service had exactly one online price (ServiceCap.priceCents)
-- and an optional door override (onsitePriceCents). Selling Oct 10 2026
-- tickets needs a promotional advance-purchase price too, so this is a THIRD
-- price, not a replacement: online (after early bird), door, and early bird.
--
-- Both columns are nullable and there is no backfill. NULL means "this phase
-- does not exist" for every existing offering — a cap with no early-bird
-- price/deadline resolves exactly as it did before this migration
-- (src/lib/pricing.ts resolvePrice treats a half-configured pair — price
-- without deadline, or deadline without price — the same way: no early bird).
ALTER TABLE "service_caps" ADD COLUMN "earlyBirdPriceCents" INTEGER;
ALTER TABLE "service_caps" ADD COLUMN "earlyBirdUntil" TIMESTAMP(3);
