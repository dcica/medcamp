import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/app/_components/SiteHeader";
import { SiteFooter } from "@/app/_components/SiteFooter";

// dcica.org's typeface. next/font self-hosts it at build time — no runtime
// request to Google, which keeps the no-external-calls posture intact.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "dcica platform",
  description:
    "Open-source event management & commerce for non-profits. Medical camp module.",
};

export const viewport: Viewport = {
  // Phone-first: lock the viewport so volunteer screens never need pinch/zoom.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={ibmPlexSans.className}>
      {/* No font-sans here: it would override the IBM Plex family set on <html>. */}
      <body>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
