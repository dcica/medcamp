/**
 * The links a coordinator prints on a flyer: one per public door the event
 * opens, plus the event page itself.
 *
 * WHY THE DOORS COME FROM `eventActions`: that function is the one copy of
 * "which buttons does the public see" (see src/lib/eventActions.ts). A flyer
 * QR that pointed at a door the site does not offer — /register on an
 * entry-fee-only event, or /vendors with vendor signups off — would be a
 * printed, unrecallable dead end. Deriving the QR set from the same list means
 * a door that is switched off has no code to print, and one that is switched
 * on cannot be forgotten.
 *
 * WHY UTM TAGS: a scan is otherwise indistinguishable from a typed URL, so the
 * acquisition report would file every flyer visit under Direct. `utm_*` is
 * preserved by the analytics scrubber on purpose (verify:analytics §6), and
 * `utm_content` names the door so the report can tell which code was scanned.
 *
 * Pure: no database, no request. The caller supplies the tenant's origin
 * (`getActiveOrigin()`), so a tenant's codes carry the tenant's own host.
 */

import { absoluteUrl, eventSlug, slugify } from "@/lib/seo";
import { eventActions, type ActionableEvent } from "@/lib/eventActions";
import type { EventOfferingKinds } from "@/server/performance";

export type MarketingLink = { key: string; label: string; url: string };

export type MarketingEvent = ActionableEvent & { name: string; code: string };

function tagged(origin: string, path: string, campaign: string, content: string): string {
  const url = new URL(absoluteUrl(origin, path));
  url.searchParams.set("utm_source", "qr");
  url.searchParams.set("utm_medium", "print");
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", content);
  return url.toString();
}

export function marketingLinks(
  origin: string,
  e: MarketingEvent,
  kinds?: EventOfferingKinds,
): MarketingLink[] {
  const campaign = slugify(e.code) || "event";
  const links: MarketingLink[] = [
    {
      key: "page",
      label: "Event page",
      url: tagged(origin, `/e/${eventSlug(e)}`, campaign, "page"),
    },
  ];
  for (const a of eventActions(e, kinds)) {
    links.push({ key: a.key, label: a.label, url: tagged(origin, a.href, campaign, a.key) });
  }
  return links;
}
