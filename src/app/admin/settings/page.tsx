import { requireCoordinator } from "@/server/admin";
import { getActiveOrg } from "@/lib/tenant";
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
      <SettingsForm
        initialName={org?.name ?? ""}
        initialBrand={settings.brand ?? "#0d6e6e"}
      />
    </div>
  );
}
