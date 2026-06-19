import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
