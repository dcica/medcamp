import Image from "next/image";
import Link from "next/link";

/**
 * Global top bar. Gives every screen a home anchor and a staff sign-in link —
 * deep-linked sub-pages (e.g. /station, /dashboard) had no way back before
 * this. Hidden on print so badge labels render clean (see .no-print).
 *
 * The wordmark is the short brand mark ("dcica") so it doesn't duplicate the
 * home page's "dcica platform" h1.
 */
export function SiteHeader() {
  return (
    // Saffron bar mirrors dcica.org's nav; navy wordmark matches the DCICA logo.
    <header className="no-print bg-accent text-accent-fg">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between px-4">
        <Link
          href="/"
          className="flex min-h-tap items-center gap-2 text-lg font-bold text-brand"
        >
          <Image
            src="/icon.png"
            alt=""
            width={28}
            height={28}
            className="rounded-full"
          />
          dcica
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/events"
            className="flex min-h-tap items-center text-sm font-semibold text-brand"
          >
            Events
          </Link>
          <Link
            href="/login"
            className="flex min-h-tap items-center text-sm font-medium text-brand"
          >
            Staff sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
