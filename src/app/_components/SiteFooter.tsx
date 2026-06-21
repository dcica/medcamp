/**
 * Site footer. Carries the open-source (AGPL-3.0) notice + contact the platform
 * mandate requires, and gives long pages a clear end. Hidden on print so
 * badge/certificate labels render clean (.no-print).
 *
 * NOTE: a Privacy Policy link belongs here too (the mandate discloses the Google
 * Address Validation call there), but no /privacy route exists yet — add it once
 * that page lands rather than pointing at a 404.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="no-print border-t border-gray-200 bg-gray-50 px-4 py-6 text-center text-xs text-gray-500">
      <p>© {year} dcica · Non-profit event management &amp; commerce</p>
      <p className="mt-1 space-x-3">
        <a
          href="https://github.com/dcica/medcamp"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Open source (AGPL-3.0)
        </a>
        <a href="mailto:sachin@buzzclan.com" className="underline">
          Contact
        </a>
      </p>
    </footer>
  );
}
