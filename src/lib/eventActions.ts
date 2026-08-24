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
