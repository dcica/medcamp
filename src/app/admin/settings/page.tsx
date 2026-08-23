import { requireCoordinator } from "@/server/admin";
import { getActiveOrg, getActiveBranding } from "@/lib/tenant";
import { DEFAULT_THEME } from "@/lib/branding";
import { PageHelp } from "@/app/_components/PageHelp";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

/** Branding & org settings — coordinator-only (config-over-code). */
export default async function SettingsPage() {
  await requireCoordinator();
  const [org, branding] = await Promise.all([getActiveOrg(), getActiveBranding()]);

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
    </div>
  );
}
