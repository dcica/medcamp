/**
 * What each listed event costs, how full it is, and whether it shares an
 * evening with another listed event.
 *
 * ONE grouped query for the whole page, mirroring offeringKindsByEvent — which
 * is the house pattern precisely because the alternative is a read per card.
 *
 * The public landing page carried no price at all before this. It could name an
 * event and its date but not the one fact that moves a decision: what it costs
 * today, and what changes if you wait.
 */

import { db } from "@/lib/db";
import { resolvePrice, type ResolvedPrice } from "@/lib/pricing";
import { priceLine, capacityLine } from "@/lib/priceLine";
import { instantToVenueInput } from "@/lib/eventTime";

export type SameEvening = {
  /** The other event sharing this venue day and venue. */
  name: string;
  /**
   * True when THIS event admits people and the other one does not — which makes
   * this the open floor beside a competition, the distinction the two Navratri
   * rows exist to draw.
   */
  openFloor: boolean;
};

export type EventSale = {
  /** "$10 through Sep 15, then $12" — already resolved and worded. */
  priceLine: string | null;
  /** "8 spots left" / "Dandiya Entry is sold out". Null when it is not news. */
  capacityLine: string | null;
  sameEveningAs: SameEvening | null;
};

export type SaleEventInput = {
  id: string;
  name: string;
  startsAt: Date;
  location: string | null;
};

type CapRow = {
  priceCents: number;
  onsitePriceCents: number | null;
  earlyBirdPriceCents: number | null;
  earlyBirdUntil: Date | null;
  capacity: number | null;
  sold: number;
  serviceType: { kind: string; name: string };
};

type Priced = { cap: CapRow; resolved: ResolvedPrice };

/** Cheapest offering of one kind, by the price a buyer would actually be charged. */
function cheapest(priced: Priced[], kind: string): Priced | null {
  let best: Priced | null = null;
  for (const p of priced) {
    if (p.cap.serviceType.kind !== kind) continue;
    if (!best || p.resolved.amountCents < best.resolved.amountCents) best = p;
  }
  return best;
}

/**
 * The offering that sets the entry price: the least a buyer can pay to get ONE
 * person in.
 *
 * Not simply the cheapest admission. The test camp offers a $0 General Consult
 * beside $15 Vision and $20 Dental, and taking the cheapest made a paid medical
 * camp announce "Free entry" on the front page. A single free service is not a
 * free door.
 *
 * So a $0 line only speaks for the event when EVERY admission is $0 — which is
 * a genuinely free door — and otherwise the cheapest PAID admission does.
 * Dandiya still reads $10 rather than $50, because its floor ticket really is
 * the cheapest way in and the family and ten-packs are bundles on top.
 */
function entryOffering(priced: Priced[]): Priced | null {
  const admissions = priced.filter((p) => p.cap.serviceType.kind === "ADMISSION");
  if (admissions.length === 0) return null;
  if (admissions.every((a) => a.resolved.amountCents === 0)) {
    return cheapest(admissions, "ADMISSION");
  }
  const paid = admissions.filter((a) => a.resolved.amountCents > 0);
  return cheapest(paid, "ADMISSION");
}

/**
 * Per-event price and capacity copy for a list of events.
 *
 * `now` is a parameter and never `new Date()` inside, the same discipline
 * resolvePrice keeps and for the same reason: the suite pins both sides of an
 * early-bird deadline without touching the clock.
 *
 * Events with no active offerings are ABSENT from the returned map rather than
 * present with nulls — the same convention offeringKindsByEvent uses, which
 * page.tsx already reads with `?.`.
 */
export async function saleSummaryByEvent(
  events: SaleEventInput[],
  now: Date,
): Promise<Map<string, EventSale>> {
  const out = new Map<string, EventSale>();
  if (events.length === 0) return out;

  // One query for the page, not one per card. `serviceType: { active: true }` is
  // the same filter offeringKindsByEvent uses, so the price line and the CTA
  // can never disagree about which offerings exist.
  const caps = await db.serviceCap.findMany({
    where: {
      eventId: { in: events.map((e) => e.id) },
      serviceType: { active: true },
    },
    select: {
      eventId: true,
      priceCents: true,
      onsitePriceCents: true,
      earlyBirdPriceCents: true,
      earlyBirdUntil: true,
      capacity: true,
      sold: true,
      serviceType: { select: { kind: true, name: true } },
    },
  });

  const byEvent = new Map<string, CapRow[]>();
  for (const c of caps) {
    const list = byEvent.get(c.eventId) ?? [];
    list.push(c);
    byEvent.set(c.eventId, list);
  }

  const siblings = sameEveningPairs(events, byEvent);

  for (const e of events) {
    const rows = byEvent.get(e.id);
    if (!rows || rows.length === 0) continue; // absent, not null-filled

    // Resolve every offering ONCE, through the same function that charges.
    // ServiceCap.priceCents is never read for display anywhere below.
    const priced: Priced[] = rows.map((cap) => ({
      cap,
      resolved: resolvePrice(cap, "online", now),
    }));

    const admission = entryOffering(priced);
    const fee = cheapest(priced, "FEE");

    // The capacity line describes the offering the card's ONE button sells.
    // eventActions puts the performance door first whenever a FEE exists, so a
    // FEE wins here too. Kind-filtered rather than summed, for the reason
    // feeCapacity spells out: a competition's group limit and a hall's door
    // limit have nothing to do with each other.
    const ctaOffering = fee ?? admission;

    out.set(e.id, {
      priceLine: priceLine({
        admission: admission?.resolved ?? null,
        fee: fee?.resolved ?? null,
        hasAnyOffering: true,
      }),
      capacityLine: ctaOffering
        ? capacityLine({
            name: ctaOffering.cap.serviceType.name,
            capacity: ctaOffering.cap.capacity,
            sold: ctaOffering.cap.sold,
            kind: ctaOffering.cap.serviceType.kind as "ADMISSION" | "MERCH" | "FEE",
          })
        : null,
      sameEveningAs: siblings.get(e.id) ?? null,
    });
  }

  return out;
}

/**
 * Which listed events share an evening at the same venue.
 *
 * Rhythm of Navratri and Dandiya Night are the same night in the same gym,
 * deliberately two rows: one is a $30-per-group competition fee that admits
 * nobody to the floor, the other is per-person floor admission. Two adjacent
 * rail cards with the same date read as one event duplicated — worse for
 * Dandiya, which has no poster of its own on purpose.
 *
 * Derived from data rather than written into the seed copy, so the next
 * overlapping pair gets the line for free, and so an existing row picks it up
 * (the events seed is upsert-only and never rewrites a description).
 *
 * Grouped on the VENUE calendar day, not the UTC one: these events run past
 * UTC midnight, which is the whole reason formatWhen needed fixing in the same
 * change. An event with no `location` is skipped entirely — a shared venue
 * cannot be claimed without one.
 */
function sameEveningPairs(
  events: SaleEventInput[],
  byEvent: Map<string, CapRow[]>,
): Map<string, SameEvening> {
  const groups = new Map<string, SaleEventInput[]>();
  for (const e of events) {
    if (!e.location) continue;
    const day = instantToVenueInput(e.startsAt).slice(0, 10);
    const key = `${day}|${e.location.trim().toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const admits = (id: string) =>
    (byEvent.get(id) ?? []).some((c) => c.serviceType.kind === "ADMISSION");

  const out = new Map<string, SameEvening>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      // The earliest OTHER event in the group. With more than two, naming one is
      // better copy than listing all of them on a 214px card.
      const other = group
        .filter((o) => o.id !== e.id)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      if (!other) continue;
      out.set(e.id, {
        name: other.name,
        openFloor: admits(e.id) && !admits(other.id),
      });
    }
  }
  return out;
}
