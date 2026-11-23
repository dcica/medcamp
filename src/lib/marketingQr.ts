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

/**
 * The share of the code's width the centre logo may cover.
 *
 * Error correction "H" restores up to 30% of codewords; a centred square at
 * 22% of the width (plus its one-module white pad) obscures under 7% of the
 * modules and never touches the three finder patterns in the corners, so the
 * code keeps most of its damage budget for the folds and scuffs a taped-up
 * flyer collects. Raising this is how a logo QR stops scanning on cheap
 * phones, so it is pinned by verify:seo §9.
 */
export const QR_LOGO_FRACTION = 0.22;

/**
 * Put a logo in the middle of a `qrcode` SVG, on a white rounded pad.
 *
 * `logoDataUri` must already be a `data:image/...;base64,` URI — an external
 * href would not survive a download or a canvas rasterise, and anything that is
 * not an image data URI is refused rather than interpolated into markup.
 * Returns the input unchanged when the logo or the SVG is not usable, so the
 * caller always has a scannable code.
 */
export function withCenterLogo(svg: string, logoDataUri: string | null): string {
  if (!logoDataUri || !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logoDataUri)) {
    return svg;
  }
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb || vb[1] !== vb[2] || !svg.trimEnd().endsWith("</svg>")) return svg;
  const n = Number(vb[1]);
  const size = n * QR_LOGO_FRACTION;
  const pad = 1;
  const at = (n - size) / 2;
  const f = (x: number) => Number(x.toFixed(3));
  const overlay =
    `<rect x="${f(at - pad)}" y="${f(at - pad)}" width="${f(size + 2 * pad)}" height="${f(size + 2 * pad)}" rx="${f(pad)}" fill="#ffffff"/>` +
    `<image x="${f(at)}" y="${f(at)}" width="${f(size)}" height="${f(size)}" preserveAspectRatio="xMidYMid meet" href="${logoDataUri}"/>`;
  const end = svg.lastIndexOf("</svg>");
  return svg.slice(0, end) + overlay + svg.slice(end);
}
