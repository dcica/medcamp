import { requireCoordinator } from "@/server/admin";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

/** Branding & org settings — coordinator-only (config-over-code). */
export default async function SettingsPage() {
  await requireCoordinator();
  const org = await getActiveOrg();
  const settings = (org?.settings ?? {}) as { brand?: string };

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
            body: "Sets the accent color across every screen. This is config-over-code — no redeploy needed.",
          },
        ]}
      />
      <div className="mt-4" />
      <SettingsForm
        initialName={org?.name ?? ""}
        initialBrand={settings.brand ?? "#0d6e6e"}
      />
    </div>
  );
}
