import Link from "next/link";

/**
 * Site top bar (brand band). Gives every screen a home anchor and a clear
 * identity. Hidden on print so badge/certificate labels render clean (.no-print).
 * Uses the per-tenant `brand` color (CSS var), so it rebrands per org for free.
 */
export function SiteHeader() {
  return (
    <header className="no-print bg-brand text-brand-fg">
      <div className="mx-auto flex max-w-screen-md items-center justify-between px-4">
        <Link
          href="/"
          className="flex min-h-tap items-center gap-2 text-lg font-bold text-brand-fg"
        >
          dcica
        </Link>
        <span className="text-sm font-medium text-brand-fg/80">
          Event platform
        </span>
      </div>
    </header>
  );
}
