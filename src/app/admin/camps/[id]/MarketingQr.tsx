import QRCode from "qrcode";
import { withCenterLogo, type MarketingLink } from "@/lib/marketingQr";
import { QrPngDownload } from "./QrPngDownload";
import { CopyUrlButton } from "./CopyUrlButton";

/**
 * Printable QR codes for each public door of an event, for flyers and posters.
 *
 * Server-rendered: the codes are generated here and shipped as data URLs, so
 * the admin page takes no QR library into its client bundle. The SVG is the
 * print master (scales to any poster size); the PNG is for Canva, WhatsApp and
 * social posts, which will not take an SVG, and is drawn from the same SVG in
 * the browser so the two files can never differ.
 *
 * The tenant's square logo sits in the middle (`withCenterLogo`). Error
 * correction is "H" for that reason: the logo spends part of the damage budget
 * that "Q" alone kept for folds and scuffs. No logo (or a logo that would not
 * load) renders the plain code.
 */
export async function MarketingQr({
  code,
  links,
  status,
  logoDataUri,
}: {
  code: string;
  links: MarketingLink[];
  status: string;
  logoDataUri: string | null;
}) {
  const items = await Promise.all(
    links.map(async (l) => {
      const plain = await QRCode.toString(l.url, {
        errorCorrectionLevel: "H",
        margin: 2,
        type: "svg",
      });
      const svg = withCenterLogo(plain, logoDataUri);
      return {
        ...l,
        svg,
        svgUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        file: `${code}-${l.key}-qr`,
      };
    }),
  );

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      {status === "DRAFT" && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          This event is a draft. These links will not open for the public until
          you open registration, so test a code before you print it.
        </p>
      )}
      <p className="text-xs text-gray-500">
        One code per button the public sees. A door you switch off under
        &ldquo;Public doors&rdquo; drops out of this list. Scans are tagged{" "}
        <code>utm_source=qr</code> so they show up in your reports.
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.key} className="flex flex-col items-center gap-2 rounded border border-gray-100 p-3">
            <p className="text-sm font-semibold">{it.label}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
            <img src={it.svgUrl} alt={`QR code for ${it.label}`} className="h-48 w-48" />
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-center text-xs text-gray-500 underline"
            >
              {it.url}
            </a>
            <div className="flex w-full gap-2">
              <CopyUrlButton url={it.url} />
            </div>
            <div className="flex w-full gap-2">
              <QrPngDownload svg={it.svg} file={it.file} />
              <a
                href={it.svgUrl}
                download={`${it.file}.svg`}
                className="flex min-h-tap flex-1 items-center justify-center rounded-md border border-gray-300 text-sm font-medium"
              >
                SVG (print)
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
