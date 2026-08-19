/**
 * Minimal raw-MIME builder for transactional email with inline images.
 *
 * WHY this exists at all — and why the QR travels as a `cid:` inline part
 * rather than an `<img src="https://…">`:
 *
 *   The pass has to work for a guest standing in a school gym with no signal.
 *   A hosted image needs a network round trip at the moment the email is
 *   OPENED, so it renders as a broken box in airplane mode — which is exactly
 *   the condition this email exists to survive (Test-Plan D-2: put the phone in
 *   airplane mode and open the email). A `data:` URI is not an option either:
 *   Gmail strips them, and Gmail is where this gets read. Only a real MIME part
 *   referenced by Content-ID is stored inside the message the client already
 *   downloaded. If you are tempted to "simplify" this to a hosted image URL,
 *   you are deleting the feature.
 *
 * WHY hand-rolled rather than nodemailer: SESv2's SendEmailCommand already
 * accepts `Content: { Raw: { Data } }`, so the only thing missing was the byte
 * assembly below — a dependency for ~80 lines of RFC 2045 would be the larger
 * cost.
 *
 * Currently used by the registration confirmation only. The volunteer signup /
 * reminder / thank-you senders and the OTP email are deliberately plain text
 * and could adopt `buildRelatedMessage()` later without changing it.
 */

const CRLF = "\r\n";

export type InlineImage = {
  /** Content-ID without angle brackets; referenced in HTML as `cid:<this>`. */
  cid: string;
  /** MIME type, e.g. "image/png". */
  contentType: string;
  /** Suggested filename (some clients show it in the attachment strip). */
  filename: string;
  data: Buffer;
};

export type RelatedMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages: InlineImage[];
  /** Injectable for deterministic tests; defaults to now. */
  date?: Date;
};

/** RFC 2047 encoded-word, so an em dash in a Subject survives the wire. */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Base64 body, hard-wrapped at 76 chars as RFC 2045 requires. */
function base64Body(data: Buffer): string {
  const b64 = data.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

/**
 * Boundary delimiters must not occur in any part's body. Base64 alphabet has no
 * "=" run followed by these letters at line start, and every body below is
 * base64, so a random suffix is belt-and-braces rather than load-bearing.
 */
function boundary(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `----=_dcica_${tag}_${rand}`;
}

/**
 * Assemble `multipart/related( multipart/alternative(text, html), image* )`.
 *
 * The nesting is not cosmetic: `related` is what binds the inline images to the
 * HTML part so `cid:` resolves, and `alternative` inside it is what lets a
 * text-only client pick the plain body instead of showing base64 soup.
 */
export function buildRelatedMessage(msg: RelatedMessage): Buffer {
  const relBoundary = boundary("rel");
  const altBoundary = boundary("alt");
  const lines: string[] = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeaderValue(msg.subject)}`,
    `Date: ${(msg.date ?? new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${relBoundary}"`,
    "",
    // Shown only by clients too old to understand multipart at all.
    "This is a multi-part message in MIME format.",
    "",
    `--${relBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(Buffer.from(msg.text, "utf8")),
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(Buffer.from(msg.html, "utf8")),
    "",
    `--${altBoundary}--`,
    "",
  ];

  for (const img of msg.inlineImages) {
    lines.push(
      `--${relBoundary}`,
      `Content-Type: ${img.contentType}; name="${img.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      "",
      base64Body(img.data),
      "",
    );
  }

  lines.push(`--${relBoundary}--`, "");
  return Buffer.from(lines.join(CRLF), "utf8");
}
