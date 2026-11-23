import { formatCents } from "@/lib/money";
import { formatVenueDate } from "@/lib/eventTime";
import { buildRelatedMessage } from "@/lib/mime";

/**
 * The donation receipt — the ORGANISATION's document, in its own words.
 *
 * It carries the amount, the organisation and the date, always; the legal
 * name, the EIN and the organisation's own receipt sentence when the
 * organisation has set them (src/lib/orgSettings.ts profile); and the honoree
 * when the donor named one. When the organisation has NOT set a sentence, the
 * receipt says nothing about deductibility or tax status: the platform never
 * asserts either on an organisation's behalf. There is no fee field on this
 * type — a receipt never mentions one.
 *
 * Pure: no Prisma model crosses this boundary (the same rule as
 * confirmationEmail.ts), so scripts/verify-performance.ts §9d pins it with a
 * literal.
 */
export type DonationReceipt = {
  to: string;
  donorName: string;
  orgName: string;
  legalName: string | null;
  ein: string | null;
  /** The organisation's own sentence, verbatim. Null ⇒ nothing is said. */
  receiptStatement: string | null;
  paidAt: Date;
  amountCents: number;
  honoreeName: string | null;
  /** The organisation's palette (branding.emailThemeOf). */
  theme: { brand: string; accent: string; accentFg: string };
};

export function donationReceiptSubject(r: DonationReceipt): string {
  return `Thank you for your gift to ${r.orgName}`;
}

/** The lines every receipt carries, in order; text and HTML render the same list. */
function receiptLinesOf(r: DonationReceipt): string[] {
  const lines = [
    `Thank you for your gift of ${formatCents(r.amountCents)} to ${r.legalName ?? r.orgName}, received ${formatVenueDate(r.paidAt)}.`,
  ];
  if (r.honoreeName) lines.push(`In honour of ${r.honoreeName}.`);
  if (r.receiptStatement) lines.push(r.receiptStatement);
  const identity = [r.legalName, r.ein ? `EIN ${r.ein}` : null].filter(Boolean).join(" · ");
  if (identity) lines.push(identity);
  lines.push("Please keep this email as your receipt.");
  return lines;
}

/** Plain-text body: the fallback for text-only clients and what the no-provider console path logs. */
export function donationReceiptText(r: DonationReceipt): string {
  return [`Hi ${r.donorName},`, ...receiptLinesOf(r)].join("\n");
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const RULE = "#e5e7eb";
const CANVAS = "#f3f4f6";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML body. Email layout is not web layout: a table, inline styles only,
 * single column. The organisation's brand colour heads it; every string is
 * escaped because the honoree and the receipt sentence are typed by people.
 */
/** The raw MIME message: text part, HTML part, no images. */
export function buildDonationReceiptMime(
  msg: DonationReceipt,
  from: string,
  replyTo?: string | null,
): Buffer {
  return buildRelatedMessage({
    from,
    replyTo,
    to: msg.to,
    subject: donationReceiptSubject(msg),
    text: donationReceiptText(msg),
    html: donationReceiptHtml(msg),
    inlineImages: [],
  });
}

export function donationReceiptHtml(r: DonationReceipt): string {
  const navy = r.theme.brand;
  const body = receiptLinesOf(r)
    .map(
      (line) =>
        `<div style="font:400 16px/1.6 ${FONT};color:#111827;padding:8px 0 0 0;">${esc(line)}</div>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:${CANVAS};margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};">
  <tr><td style="background:${navy};padding:20px 24px;">
    <div style="font:700 20px/1.3 ${FONT};color:${r.theme.accentFg === "#ffffff" ? "#ffffff" : "#ffffff"};">${esc(r.orgName)}</div>
    <div style="font:400 14px/1.5 ${FONT};color:#e5e7eb;padding:4px 0 0 0;">Donation receipt</div>
  </td></tr>
  <tr><td style="padding:24px 24px 24px 24px;">
    <div style="font:400 16px/1.6 ${FONT};color:#111827;">Hi ${esc(r.donorName)},</div>
    ${body}
  </td></tr>
</table>
</td></tr>
</table>`;
}
