/**
 * Which public doors an event opens, and what the primary one is called.
 *
 * Moved out of src/app/page.tsx unchanged. It lived there as a module-private
 * function, which meant the single most consequential rule on the public site —
 * "an entry-fee event must NOT say Register" — was unreachable from any verify
 * script. That rule is the one the Festival of Lights outage was about: a paid,
 * capped competition offering was reachable by nobody for the stretch between
 * the day it was priced and 2026-08-23. It gets a test now.
 *
 * The input is a structural type rather than the Prisma model, the same trick
 * resolvePrice uses on `cap`, so a select-narrowed row satisfies it.
 */

import type { EventOfferingKinds } from "@/server/performance";

export const TYPE_LABEL: Record<string, string> = {
  CAMP: "Medical camp",
  GENERAL: "Event",
  MEMBERSHIP_DRIVE: "Membership",
};

// Primary registration wording by event type.
export const REGISTER_LABEL: Record<string, string> = {
  CAMP: "Register",
  GENERAL: "Buy tickets",
  MEMBERSHIP_DRIVE: "Join or renew",
};

export type ActionableEvent = {
  id: string;
  type: string;
  offersRegistration: boolean;
  offersVendors: boolean;
  offersVolunteers: boolean;
};

export type EventAction = { key: string; label: string; href: string };

/**
 * The doors that take money. Everything else (volunteer, vendor) stays open
 * when an event is sold out.
 *
 * ONE COPY, because the card and the event page both have to make this call and
 * a divergence is invisible until someone is charged. `eventActions` decides
 * the doors from CONFIGURATION alone — offersRegistration, type, offering kinds
 * — and knows nothing about capacity; `EventSale.offer.soldOut` is the other
 * half, and it is computed from `ctaOffering`, which eventSales picks to match
 * this function's ordering. So the two line up by construction: the sold-out
 * flag is about the offering these keys sell, and no other.
 *
 * This exists because GARBA-2026 sat on the front page at 50/50 sold showing
 * "Class Entry is sold out" directly above a live "Buy tickets" button, on
 * 2026-09-19, three hours before the class. Tapping it was not merely
 * confusing: capacity is claimed at CONFIRMATION, never at checkout creation
 * (see the note on resumeCheckoutForOrder in src/server/payments.ts), so the
 * buyer pays, the claim fails, and a human has to notice and refund. The
 * structured data was already emitting schema.org/SoldOut at the time — only
 * the part a person reads was wrong.
 */
const PAID_DOOR_KEYS: ReadonlySet<string> = new Set(["register", "perform"]);

export function isPaidDoor(action: EventAction | undefined): boolean {
  return action !== undefined && PAID_DOOR_KEYS.has(action.key);
}

// Config-driven action set for an event. First entry is the primary CTA.
export function eventActions(
  e: ActionableEvent,
  kinds?: EventOfferingKinds,
): EventAction[] {
  const actions: EventAction[] = [];
  // An entry fee needs the performance form, which collects group details
  // /register has no notion of. When an event sells BOTH, both doors are
  // legitimate and both are shown; when it sells only entry fees, "Register" is
  // simply the wrong word and the wrong page.
  if (e.offersRegistration && kinds?.hasFee)
    actions.push({
      key: "perform",
      label: "Enter a performance",
      href: `/perform?event=${e.id}`,
    });
  if (e.offersRegistration && (kinds?.hasOther ?? true))
    actions.push({
      key: "register",
      label: REGISTER_LABEL[e.type] ?? "Register",
      href: `/register?event=${e.id}`,
    });
  if (e.offersVolunteers)
    actions.push({
      key: "volunteer",
      label: "Volunteer",
      href: `/volunteer?event=${e.id}`,
    });
  if (e.offersVendors)
    actions.push({
      key: "vendor",
      label: "Register as vendor",
      href: `/vendors?event=${e.id}`,
    });
  return actions;
}
