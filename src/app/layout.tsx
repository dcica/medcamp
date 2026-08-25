import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/app/_components/SiteHeader";
import { SiteFooter } from "@/app/_components/SiteFooter";
import { Analytics } from "@/app/_components/Analytics";
import { getActiveBranding } from "@/lib/tenant";
import { brandingStyleVars } from "@/lib/branding";
import { siteUrl } from "@/lib/seo";
import { env } from "@/lib/env";

// dcica.org's typeface. next/font self-hosts it at build time — no runtime
// request to Google for fonts, on any page. (The one deliberate third-party
// call in the shell is gtag.js, and only when a tenant sets a measurement id —
// see _components/Analytics.tsx.)
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * Site-wide metadata defaults.
 *
 * A FUNCTION rather than the static `metadata` object it replaces, for the same
 * reason the layout below is async: the title carried the literal string
 * "DCICA" on every page of a product whose founding mandate is that dcica is
 * one tenant among many. A self-hoster in Edison NJ should not have to edit
 * source to stop their browser tab saying somebody else's name.
 *
 * `metadataBase` is the load-bearing line and it is easy to miss. Without it
 * Next emits every `alternates.canonical` and every OG `url` as a RELATIVE
 * path, which is not a valid canonical and not a resolvable OG target — the
 * per-page canonicals added across this change would all have been silently
 * inert. One URL, set once, and every relative reference below resolves
 * against it.
 *
 * The default description is a real description of what a visitor can do here,
 * not the repo's one-line pitch. "Open-source event management & commerce for
 * non-profits. Medical camp module." described the SOFTWARE to a developer,
 * which is the wrong audience for a page whose readers are looking for a garba
 * night — and it was the description of every page on the site.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getActiveBranding();
  const name = branding.orgName;
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${name} — events, tickets and volunteering`,
      // Every page that sets a plain string title gets the org appended, so a
      // browser tab and a search result both say whose event it is.
      template: `%s · ${name}`,
    },
    description: `Upcoming ${name} events: buy tickets, register, enter a performance, or sign up to volunteer.`,
    applicationName: name,
    openGraph: { siteName: name, locale: "en_US", type: "website" },
    // Stated rather than assumed. The pages that must NOT be indexed override
    // this with their own `robots` export; see src/app/robots.ts for why the
    // per-page directive is the control and robots.txt is not.
    robots: { index: true, follow: true },
    formatDetection: { telephone: false },
    // Emitted only when this deployment has a Search Console token configured;
    // `undefined` renders no tag at all. See the env schema for why this is an
    // env var and not a tenant setting.
    verification: env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
      : undefined,
  };
}

export const viewport: Viewport = {
  // Phone-first means volunteer screens never NEED pinch/zoom — it does not mean
  // blocking it. maximumScale: 1 fails WCAG 1.4.4 (Resize Text): low-vision users
  // and anyone reading a badge in bad light lose the ability to zoom at all.
  // Design for no-zoom-required; still allow zoom.
  width: "device-width",
  initialScale: 1,
};

/**
 * Async because the active tenant's theme has to be resolved before the shell
 * renders. EVERY route declares `force-dynamic`, so this changes
 * nothing architecturally, and `getActiveBranding` is request-cached — the
 * layout, the header and the footer share one query.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branding = await getActiveBranding();

  // The tenant's palette, emitted as CSS custom properties on <html>.
  //
  // WHY a style ATTRIBUTE and not a <style> element: values that fail the
  // render-time hex check are dropped rather than emitted (see
  // brandingStyleVars), but if one ever did get through, a style attribute
  // confines it to a declaration on this one element — it cannot close a rule
  // and open a new selector, which is what makes a <style> block a real
  // injection surface. React also serializes the attribute for us.
  //
  // undefined when the tenant has no theme, so no attribute is rendered at all
  // and the `:root` defaults in globals.css win. Those fallbacks stay: they are
  // what makes a themeless tenant (and a self-hoster's empty database) render
  // correctly, and they are the reason this change is visually inert until a
  // theme is deliberately saved.
  const themeStyle = brandingStyleVars(branding.theme) as CSSProperties | undefined;

  return (
    <html lang="en" className={ibmPlexSans.className} style={themeStyle}>
      {/* No font-sans here: it would override the IBM Plex family set on <html>. */}
      <body>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
        {/* No-ops unless the tenant has configured a GA measurement id. */}
        <Analytics />
      </body>
    </html>
  );
}
