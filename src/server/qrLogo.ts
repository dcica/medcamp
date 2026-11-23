import { resolveBranding } from "@/lib/branding";

/**
 * The tenant's square logo as a data URI, for the centre of a flyer QR code.
 *
 * WHY FETCH AT ALL. The QR files are downloaded and dropped into Canva or sent
 * to a print shop, where an `href` back to our host would be a broken image. So
 * the logo bytes have to travel inside the file.
 *
 * WHY THIS IS SAFE TO FETCH. `resolveBranding` only ever yields a same-origin
 * path or a URL in this deployment's own public storage bucket
 * (`sanitizeAssetUrl`), so the URL fetched here is never tenant-chosen beyond
 * those two places. Redirects are refused, the body is capped, and only image
 * types are accepted, so a misconfigured asset cannot smuggle markup in.
 *
 * NULL IS A NORMAL ANSWER: any failure renders the plain code, which still
 * scans. A flyer page must never break because a logo is slow.
 */
const MAX_LOGO_BYTES = 1_000_000;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export async function qrLogoDataUri(
  settings: unknown,
  orgName: string | null | undefined,
  origin: string,
): Promise<string | null> {
  const { markUrl } = resolveBranding(settings, orgName);
  try {
    // An absolute path resolves against the host root, so a path-routed tenant
    // origin (https://host/o/slug) still reaches /icon.png on the host.
    const res = await fetch(new URL(markUrl, origin), {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_LOGO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
