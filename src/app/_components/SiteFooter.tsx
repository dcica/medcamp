import Link from "next/link";
import { getActiveBranding, getActiveLegal, getActiveOrg, getActiveProfile } from "@/lib/tenant";
import { resolveOrgDonations } from "@/lib/orgSettings";
import { PLATFORM_REPO_URL } from "@/lib/platform";

/**
 * Global footer. Carries the open-source (AGPL-3.0) notice and contact the
 * platform mandate requires, and gives long pages a clear end. Hidden on print
 * so badge labels render clean (see .no-print).
 *
 * NOTE: a Privacy Policy link belongs here too (the mandate discloses the
 * Google Address Validation call there), but no /privacy route exists yet —
 * link it once that page lands rather than pointing at a 404.
 *
 * Async now, so the copyright line can carry the ACTIVE TENANT'S name instead of
 * a literal. Threading it down as a prop from the layout was the alternative;
 * reading it here keeps the footer self-contained and costs nothing, because
 * `getActiveBranding` is request-cached and the root layout has already resolved
 * it by the time this renders.
 */
export async function SiteFooter() {
  const year = new Date().getFullYear();
  const [branding, profile, legal, org] = await Promise.all([
    getActiveBranding(),
    getActiveProfile(),
    getActiveLegal(),
    getActiveOrg(),
  ]);
  // The same flag /donate itself reads: the link exists exactly when the page does.
  const donations = resolveOrgDonations(org?.settings);
  return (
    // Flag-green band mirrors dcica.org's footer.
    <footer className="no-print bg-accent2 px-4 py-6 text-center text-xs text-accent2-fg">
      <p>
        © {year} {branding.orgName} · Non-profit event management &amp; commerce
      </p>
      {/* Inline-flex links at min-h-tap: the platform rule is a 48px target on
          every interactive element, and these were 15px tall — the smallest tap
          targets on the site. */}
      <p className="mt-1 flex flex-wrap items-center justify-center gap-x-6">
        <a
          href={PLATFORM_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-tap items-center underline"
        >
          Open source (AGPL-3.0)
        </a>
        {donations.enabled && (
          <Link href="/donate" className="inline-flex min-h-tap items-center underline">
            Donate
          </Link>
        )}
        {profile.contactEmail && (
          <a
            href={`mailto:${profile.contactEmail}`}
            className="inline-flex min-h-tap items-center underline"
          >
            Contact
          </a>
        )}
        {legal.privacy && (
          <Link href="/privacy" className="inline-flex min-h-tap items-center underline">
            Privacy
          </Link>
        )}
        {legal.terms && (
          <Link href="/terms" className="inline-flex min-h-tap items-center underline">
            Terms
          </Link>
        )}
      </p>
    </footer>
  );
}
