-- Three service kinds instead of two.
--
-- Until now a service was merch (fulfillable) or, by inference, admission.
-- That left no way to model a pure fee — a dance-competition entry that grants
-- no floor access — which would otherwise mint one scannable ticket per group
-- and inflate the door headcount.
--
-- Backfilled as NOT fulfillable so every existing service keeps its current
-- behaviour exactly: merch stops "admitting" (it never did), everything else
-- continues to issue a ticket.
ALTER TABLE "service_types" ADD COLUMN "admits" BOOLEAN NOT NULL DEFAULT true;
UPDATE "service_types" SET "admits" = NOT "fulfillable";

-- Door price, when it differs from the online price ($15 online / $20 walk-up).
-- NULL means "charge the online price at the door too", which is what every
-- existing offering does today.
ALTER TABLE "service_caps" ADD COLUMN "onsitePriceCents" INTEGER;
