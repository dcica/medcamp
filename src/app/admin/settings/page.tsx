import { requireCoordinator } from "@/server/admin";
import { getActiveOrg, getActiveBranding, getActiveLegal, getActiveProfile, getActiveSite } from "@/lib/tenant";
import { DEFAULT_THEME } from "@/lib/branding";
import { PageHelp } from "@/app/_components/PageHelp";
import { SettingsForm } from "./SettingsForm";
import { ProfileForm } from "./ProfileForm";
import { SiteForm } from "./SiteForm";
import { LegalForm } from "./LegalForm";
import { StripeCard } from "./StripeCard";
import { DonationsForm } from "./DonationsForm";
import { resolveOrgDonations } from "@/lib/orgSettings";

export const dynamic = "force-dynamic";

/** Branding & org settings — coordinator-only (config-over-code). */
export default async function SettingsPage() {
  await requireCoordinator();
  const [org, branding, profile, site, legal] = await Promise.all([
    getActiveOrg(),
    getActiveBranding(),
    getActiveProfile(),
    getActiveSite(),
    getActiveLegal(),
  ]);

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Organization settings
      </h2>
      <PageHelp
        id="admin-settings"
        items={[
          {
            label: "Organization name",
            body: "Shown to patients on the registration portal and confirmation pages.",
          },
          {
            label: "Payments",
            body: "Your organisation's own Stripe account, connected through Stripe's guided setup. Money settles there directly; the platform's service fee is split off by Stripe at charge time and we never hold your funds. Online sales are refused until Stripe has enabled charges on the account.",
          },
          {
            label: "Contact, mail and receipts",
            body: "The contact address appears in the footer and as the reply-to on every email. The sender address is the From line and must be a verified identity with the email provider. Legal name, EIN, tax status and the receipt sentence are printed on receipts and certificates exactly as entered — the platform never asserts a tax status for you.",
          },
          {
            label: "Donations",
            body: "Turn on the donate page, pick the suggested amounts and the minimum, and whether donors may cover your processing cost. Gifts carry no platform fee; a receipt with your legal name, EIN and receipt sentence is emailed when each gift clears. The year-end list is under Admin → Donations.",
          },
          {
            label: "Analytics and search",
            body: "Your own Google Analytics property and Search Console token. Blank means no analytics script on your pages; staff screens are never reported either way.",
          },
          {
            label: "Privacy policy and terms",
            body: "Your own text, published at /privacy and /terms and linked from the footer as soon as it is saved. The platform never writes a policy for you: say what you collect, how long you keep donor and attendee records, and how to reach you.",
          },
          {
            label: "Brand color",
            body: "Buttons, headings and links across every screen. Saving takes effect immediately — no redeploy. The text color on top is picked for you, and a color too pale to carry readable text is refused rather than saved.",
          },
        ]}
      />
      <div className="mt-4" />
      {/* The field is seeded from the colour the site IS RENDERING, not from the
          legacy `settings.brand` value — which stores a teal that has never been
          on screen. Seeding from the stale value would mean a coordinator who
          opens this page to fix a typo in the org name and presses Save would
          repaint the whole site teal without ever touching the colour input. */}
      <SettingsForm
        initialName={org?.name ?? ""}
        initialBrand={branding.theme?.brand ?? DEFAULT_THEME.brand}
      />
      <StripeCard
        state={!org?.stripeAccountId ? "none" : org.stripeChargesEnabled ? "connected" : "incomplete"}
        accountId={org?.stripeAccountId ?? null}
        payoutsEnabled={org?.stripePayoutsEnabled ?? false}
        achEnabled={org?.stripeAchEnabled ?? false}
      />
      <ProfileForm initial={profile} />
      <DonationsForm initial={resolveOrgDonations(org?.settings)} />
      <SiteForm initial={site} />
      <LegalForm initial={legal} />
    </div>
  );
}
