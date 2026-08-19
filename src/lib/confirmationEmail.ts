import QRCode from "qrcode";
import { formatCents } from "@/lib/money";
import { formatWhen } from "@/lib/eventTime";
import { buildRelatedMessage, type InlineImage } from "@/lib/mime";

/**
 * The registration confirmation email — the one email that must CARRY the pass
 * rather than link to it (design Operations 10, ledger finding F5).
 *
 * Everything the layout needs is passed in explicitly; no Prisma model crosses
 * this boundary. No PHI and no per-attendee personal data: the only person named
 * here is the registrant, and a ticket is identified by its camp ID alone.
 */
export type ConfirmationLine = {
  description: string;
  /** Units on this line. Line total = amountCents * quantity. */
  quantity: number;
  /** Per-unit price in integer cents. */
  amountCents: number;
};

export type ConfirmationMerch = {
  description: string;
  quantity: number;
};

export type ConfirmationEmail = {
  to: string;
  registrantName: string;
  eventName: string;
  confirmUrl: string;
  campIds: string[];
  /** Everything bought on this order, for the PAID block. */
  lineItems: ConfirmationLine[];
  /** Physical goods to hand over at the gate. Empty ⇒ the block is omitted. */
  merch: ConfirmationMerch[];
  /** What was actually paid, integer cents. */
  totalPaidCents: number;
  /** `Event.location`; null when the event has no location line yet. */
  venue: string | null;
  startsAt: Date;
  endsAt: Date;
  /** `Event.allowsRefunds` — decides which approved refund wording applies. */
  allowsRefunds: boolean;
};

// ── Design tokens. The email copies them rather than importing the Tailwind
// theme because inline styles are the only styling a mail client honours. ──
const NAVY = "#0c3543";
const SAFFRON = "#f9a200";
const CANVAS = "#f7faf9";
/** Ink on saffron. White on saffron is banned — it fails contrast. */
const INK = "#16201f";
const RULE = "#d8e2e0";
const MUTED = "#4a5c5a";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The refund line, VERBATIM from the register page's pay-button line
 * (`src/app/register/RegisterForm.tsx`), which Tasks C3 and C4 established as
 * the single authoritative wording. Do not paraphrase: a third voice on the
 * refund policy is a promise about money the org has not made.
 */
function refundLine(allowsRefunds: boolean): string {
  return allowsRefunds
    ? "Refunds are handled by staff, not online — there is no self-serve refund in this form."
    : "All sales are final — no refunds, including no-shows.";
}

/** Content-ID for a ticket's QR. Unique per camp ID; referenced once as `cid:`. */
function qrCid(campId: string, index: number): string {
  return `qr-${index}-${campId}@dcica`;
}

/**
 * The plain-text body. BYTE-IDENTICAL to what this email has always sent: it is
 * the fallback for text-only clients and it is what the no-provider console
 * path logs. Do not "improve" it here.
 */
export function confirmationText(msg: ConfirmationEmail): string {
  return [
    `Hi ${msg.registrantName},`,
    `Your registration for ${msg.eventName} is confirmed.`,
    `Camp ID(s): ${msg.campIds.join(", ")}`,
    `View your QR badge: ${msg.confirmUrl}`,
  ].join("\n");
}

export function confirmationSubject(msg: ConfirmationEmail): string {
  return `${msg.eventName} — registration confirmed`;
}

/** One section heading, styled identically wherever it appears. */
function heading(text: string): string {
  return `<div style="font:600 13px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};padding:0 0 8px 0;">${esc(text)}</div>`;
}

function ticketBlock(campId: string, index: number): string {
  const cid = qrCid(campId, index);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ${RULE};background:#ffffff;margin:0 0 12px 0;">
  <tr>
    <td style="background:${SAFFRON};color:${INK};font:700 18px/1.3 ${FONT};padding:10px 16px;letter-spacing:.04em;">${esc(campId)}</td>
  </tr>
  <tr>
    <td align="center" style="padding:16px;">
      <img src="cid:${esc(cid)}" width="220" height="220" alt="QR code for ticket ${esc(campId)}" style="display:block;width:220px;height:220px;border:0;outline:none;" />
      <div style="font:400 13px/1.5 ${FONT};color:${MUTED};padding:10px 0 0 0;">Show this at the gate. It works with no signal.</div>
    </td>
  </tr>
</table>`;
}

function paidBlock(msg: ConfirmationEmail): string {
  const rows = msg.lineItems
    .map(
      (li) => `
  <tr>
    <td style="font:400 15px/1.5 ${FONT};color:${NAVY};padding:6px 0;border-bottom:1px solid ${RULE};">${esc(li.description)}${li.quantity > 1 ? ` <span style="color:${MUTED};">&times; ${li.quantity}</span>` : ""}</td>
    <td align="right" style="font:400 15px/1.5 ${FONT};color:${NAVY};padding:6px 0;border-bottom:1px solid ${RULE};white-space:nowrap;">${esc(formatCents(li.amountCents * li.quantity))}</td>
  </tr>`,
    )
    .join("");
  return `
${heading("Paid")}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
  ${rows}
  <tr>
    <td style="font:700 16px/1.5 ${FONT};color:${NAVY};padding:10px 0 0 0;">Total paid</td>
    <td align="right" style="font:700 16px/1.5 ${FONT};color:${NAVY};padding:10px 0 0 0;white-space:nowrap;">${esc(formatCents(msg.totalPaidCents))}</td>
  </tr>
</table>`;
}

function merchBlock(msg: ConfirmationEmail): string {
  if (msg.merch.length === 0) return "";
  const rows = msg.merch
    .map(
      (m) =>
        `<li style="font:400 15px/1.6 ${FONT};color:${NAVY};">${esc(m.description)}: ${m.quantity} to collect at the gate</li>`,
    )
    .join("");
  return `
  <tr><td style="padding:20px 24px 0 24px;">
    ${heading("Collect at the gate")}
    <ul style="margin:0;padding:0 0 0 20px;">${rows}</ul>
  </td></tr>`;
}

/**
 * The HTML body. Email layout is not web layout: tables for structure, inline
 * styles only (Gmail strips &lt;style&gt; blocks in several contexts), single
 * column, square corners.
 */
export function confirmationHtml(msg: ConfirmationEmail): string {
  const headcount = msg.campIds.length;
  const tickets = msg.campIds.map((id, i) => ticketBlock(id, i)).join("");
  // The venue timezone helper, not a bare Intl call: an email that states a
  // different time from the website is the defect Task G4 just fixed, coming
  // back in a channel nobody re-checks.
  const when = formatWhen(msg.startsAt, msg.endsAt);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:${CANVAS};margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};">

  <tr><td style="background:${NAVY};padding:20px 24px;">
    <div style="font:700 20px/1.3 ${FONT};color:#ffffff;">${esc(msg.eventName)}</div>
    <div style="font:400 14px/1.5 ${FONT};color:#cfe0dd;padding:4px 0 0 0;">Registration confirmed</div>
  </td></tr>

  <tr><td style="padding:24px 24px 0 24px;">
    <div style="font:400 16px/1.6 ${FONT};color:${NAVY};">Hi ${esc(msg.registrantName)},</div>
    <div style="font:400 16px/1.6 ${FONT};color:${NAVY};padding:8px 0 0 0;">Your registration is confirmed. This email admits <strong>${headcount} ${headcount === 1 ? "guest" : "guests"}</strong> — one code below per guest.</div>
  </td></tr>

  <tr><td style="padding:20px 24px 0 24px;">
    ${heading(headcount === 1 ? "Your ticket" : `Your ${headcount} tickets`)}
    ${tickets}
  </td></tr>

  <tr><td style="padding:8px 24px 0 24px;">
    ${paidBlock(msg)}
  </td></tr>
${merchBlock(msg)}
  <tr><td style="padding:20px 24px 0 24px;">
    ${heading("Where and when")}
    <div style="font:400 15px/1.6 ${FONT};color:${NAVY};">${msg.venue ? `${esc(msg.venue)}<br />` : ""}${esc(when)}</div>
  </td></tr>

  <tr><td style="padding:20px 24px 24px 24px;">
    <div style="font:400 14px/1.6 ${FONT};color:${MUTED};border-top:1px solid ${RULE};padding:16px 0 0 0;">${esc(refundLine(msg.allowsRefunds))}</div>
    <div style="font:400 14px/1.6 ${FONT};color:${MUTED};padding:8px 0 0 0;">Got signal? <a href="${esc(msg.confirmUrl)}" style="color:${NAVY};">View your QR badge online</a>.</div>
  </td></tr>

</table>
</td></tr>
</table>`;
}

/**
 * Build the full raw MIME message, QR images included.
 *
 * `QRCode.toBuffer` gives a real PNG part; each ticket gets its own part and its
 * own Content-ID, so a party of five carries five distinct images. The image is
 * 220px so it still scans off a phone screen held under a gate scanner, and its
 * `alt` carries the code so a client that blocks images still shows the ticket.
 */
export async function buildConfirmationMime(
  msg: ConfirmationEmail,
  from: string,
): Promise<Buffer> {
  const inlineImages: InlineImage[] = [];
  for (const [i, campId] of msg.campIds.entries()) {
    inlineImages.push({
      cid: qrCid(campId, i),
      contentType: "image/png",
      filename: `${campId}.png`,
      data: await QRCode.toBuffer(campId, { margin: 1, width: 220 }),
    });
  }
  return buildRelatedMessage({
    from,
    to: msg.to,
    subject: confirmationSubject(msg),
    text: confirmationText(msg),
    html: confirmationHtml(msg),
    inlineImages,
  });
}
