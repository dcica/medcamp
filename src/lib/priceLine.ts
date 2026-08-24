/**
 * The public card's price and capacity copy.
 *
 * Deliberately NOT in src/lib/pricing.ts. That file is the single price
 * resolver and its purity is the point — every charging path calls it. This is
 * presentation: it takes a ResolvedPrice and decides what a person reads. Two
 * different jobs, and keeping them apart is what lets the copy be pinned by a
 * test that never opens a database connection.
 *
 * Pure, like the resolver: no `new Date()`, no db, no env.
 */

import type { ServiceKind } from "@prisma/client";
import type { ResolvedPrice } from "@/lib/pricing";
import { formatCentsCompact } from "@/lib/money";
import { formatVenueMonthDay } from "@/lib/eventTime";

/**
 * A FEE buys a slot for a troupe; an ADMISSION buys one person through a door.
 * Wording these the same way is the mistake the split exists to prevent — a
 * "$30" on a competition card that a family reads as per-person is a $120
 * misunderstanding at the desk.
 */
type Unit = "person" | "group";

function amountPhrase(r: ResolvedPrice, unit: Unit): string {
  const head =
    r.amountCents === 0
      ? "Free"
      : formatCentsCompact(r.amountCents) + (unit === "group" ? " a group" : "");

  if (r.phase === "early-bird" && r.earlyBirdEndsAt && r.nextAmountCents !== null) {
    // `earlyBirdUntil` is an EXCLUSIVE bound in resolvePrice (`now < until`), so
    // the last day a buyer can actually pay this price is the venue day of one
    // second before it. Formatting the deadline's own venue day is right only by
    // accident for the seed's 23:59:59 values, and WRONG for a clean midnight
    // one — 2026-09-01T05:00:00Z is midnight Sep 1 in Flower Mound, and
    // printing "through Sep 1" there advertises a day the price is already gone.
    const lastDay = formatVenueMonthDay(new Date(r.earlyBirdEndsAt.getTime() - 1000));
    return `${head} through ${lastDay}, then ${formatCentsCompact(r.nextAmountCents)}`;
  }

  // resolvePrice only sets nextAmountCents when it is STRICTLY higher, so this
  // never renders "$15 · $15 at the door".
  if (r.nextAmountCents !== null) {
    return `${head} \u00b7 ${formatCentsCompact(r.nextAmountCents)} at the door`;
  }

  return head;
}

/**
 * The one line on a card that moves a decision: what this costs, and what
 * changes if you wait.
 */
export function priceLine(p: {
  /** Resolved price of the cheapest ADMISSION offering; null when none admits. */
  admission: ResolvedPrice | null;
  /** Resolved price of the cheapest FEE offering; null when there is none. */
  fee: ResolvedPrice | null;
  /** Whether the event has ANY active offering at all. */
  hasAnyOffering: boolean;
}): string | null {
  // An event nobody has priced yet says nothing. Silence is the honest output:
  // there is no price to state and no claim about entry that the data supports.
  if (!p.hasAnyOffering) return null;

  const parts: string[] = [];

  if (p.admission) {
    const phrase = amountPhrase(p.admission, "person");
    parts.push(phrase === "Free" ? "Free entry" : phrase);
  } else {
    // WHY this is safe to assert, given no column says "free":
    //
    // The event IS configured — hasAnyOffering is true, so someone priced
    // something against it — and it sells nothing that admits a person. There
    // is therefore nothing to buy in order to get in. That is DCICA Festival of
    // Lights, whose flyer says free entry and free parking, and Rhythm of
    // Navratri, whose seed states outright that there is no floor sale at that
    // event at all.
    //
    // The guard that makes this honest is the early return above: an event with
    // ZERO active offerings is not free, it is unconfigured, and it gets no
    // price line rather than advertising a door nobody set a price on.
    parts.push("Free entry");
  }

  // A free fee has nothing to say. "Free entry \u00b7 Free" is noise, not urgency.
  if (p.fee && p.fee.amountCents > 0) parts.push(amountPhrase(p.fee, "group"));

  return parts.join(" \u00b7 ");
}

/** Below this many left, or this fraction of the ceiling, the number is news. */
const LOW_ABSOLUTE = 10;
const LOW_FRACTION = 0.2;

/**
 * "8 spots left" / "Dandiya Entry is sold out" — or nothing.
 *
 * ONE offering, never a sum across them. seed-events.ts spells out why: Dandiya
 * sells 500 singles, 50 family-of-4 and 20 ten-packs, which is 900 heads if it
 * all sells and "is not enforced as one" limit. A summed "570 left" would be a
 * number with no referent.
 */
export function capacityLine(o: {
  name: string;
  capacity: number | null;
  sold: number;
  kind: ServiceKind;
}): string | null {
  // Uncapped is not zero. Same distinction feeCapacity makes, for the same
  // reason it returns null: "12 of 0" reads as oversold.
  if (o.capacity === null) return null;

  const remaining = o.capacity - o.sold;

  // `<= 0` and not `=== 0`: a cap lowered under its own sold count is a state
  // that has existed here (see the mid-flight-edit note in payments.ts), and
  // "-3 spots left" is worse than the truth.
  if (remaining <= 0) return `${o.name} is sold out`;

  // Never "40 of 40 left". A ceiling nobody is near is not urgency, and printing
  // it on every card teaches a reader to skip the line that matters.
  const threshold = Math.max(LOW_ABSOLUTE, Math.floor(o.capacity * LOW_FRACTION));
  if (remaining > threshold) return null;

  return o.kind === "FEE"
    ? `${remaining} group ${remaining === 1 ? "slot" : "slots"} left`
    : `${remaining} ${remaining === 1 ? "spot" : "spots"} left`;
}
