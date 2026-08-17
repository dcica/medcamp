/**
 * Global footer. Carries the open-source (AGPL-3.0) notice and contact the
 * platform mandate requires, and gives long pages a clear end. Hidden on print
 * so badge labels render clean (see .no-print).
 *
 * NOTE: a Privacy Policy link belongs here too (the mandate discloses the
 * Google Address Validation call there), but no /privacy route exists yet —
 * link it once that page lands rather than pointing at a 404.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    // Flag-green band mirrors dcica.org's footer.
    <footer className="no-print bg-accent2 px-4 py-6 text-center text-xs text-accent2-fg">
      <p>© {year} dcica · Non-profit event management &amp; commerce</p>
      {/* Inline-flex links at min-h-tap: the platform rule is a 48px target on
          every interactive element, and these were 15px tall — the smallest tap
          targets on the site. */}
      <p className="mt-1 flex flex-wrap items-center justify-center gap-x-6">
        <a
          href="https://github.com/dcica/medcamp"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-tap items-center underline"
        >
          Open source (AGPL-3.0)
        </a>
        <a
          href="mailto:sachin@buzzclan.com"
          className="inline-flex min-h-tap items-center underline"
        >
          Contact
        </a>
      </p>
    </footer>
  );
}
