import { requireCoordinator } from "@/server/admin";
import { emailConfig, getSesAccountStatus } from "@/lib/email";
import { PageHelp } from "@/app/_components/PageHelp";
import { TestEmailForm } from "./TestEmailForm";

export const dynamic = "force-dynamic";

/** Email provider status + test send — coordinator-only. */
export default async function EmailAdminPage() {
  const member = await requireCoordinator();
  const cfg = emailConfig();
  const ses = cfg.provider === "ses" ? await getSesAccountStatus() : null;

  const rows: { label: string; value: string }[] = [
    { label: "Provider", value: cfg.provider },
    { label: "From address", value: cfg.from },
  ];
  if (cfg.provider === "ses") {
    rows.push(
      { label: "AWS region", value: cfg.region ?? "(not set)" },
      { label: "AWS access key", value: cfg.awsKeyHint ?? "(not set)" },
      {
        label: "AWS secret",
        value:
          cfg.awsSecretLen > 0
            ? `set (${cfg.awsSecretLen} chars${cfg.awsSecretLen === 40 ? "" : " — expected 40!"})`
            : "(not set)",
      },
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Email
      </h2>
      <PageHelp
        id="admin-email"
        items={[
          {
            label: "Provider",
            body: "Set EMAIL_PROVIDER and the matching credentials in the deployment environment. SES also needs AWS_REGION and a verified From identity.",
          },
          {
            label: "Not configured?",
            body: "With no provider wired up, confirmation emails are written to the server console instead of being sent. Patients won't receive them.",
          },
          {
            label: "Test send",
            body: "Sends a one-off email to any address so you can confirm delivery before camp day. Errors from the provider are shown verbatim.",
          },
        ]}
      />

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              cfg.configured ? "bg-green-500" : "bg-amber-400"
            }`}
          />
          <span className="text-sm font-medium">
            {cfg.configured
              ? "Provider configured — emails will be sent."
              : "No provider configured — emails are logged to the console only."}
          </span>
        </div>
        <dl className="divide-y divide-gray-100 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 py-2">
              <dt className="text-gray-500">{r.label}</dt>
              <dd className="font-mono text-gray-800">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {ses && !ses.productionAccess && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            SES is in sandbox mode
          </p>
          <p className="mt-1 text-sm text-amber-800">
            You can only send to verified addresses or domains. Emails to
            unverified patient addresses will be rejected. Request production
            access in the SES console (Account dashboard) before camp day — the
            green dot above only means credentials work, not that real sends
            will deliver.
          </p>
        </div>
      )}

      {ses && ses.productionAccess && !ses.sendingEnabled && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">
            SES sending is paused for this account
          </p>
          <p className="mt-1 text-sm text-red-800">
            No email will be delivered until sending is re-enabled in the SES
            console (usually paused after bounce/complaint spikes).
          </p>
        </div>
      )}

      {ses && ses.productionAccess && ses.sendingEnabled && (
        <p className="mt-2 text-xs text-green-700">
          SES production access enabled — real sends will deliver.
        </p>
      )}

      <div className="mt-4" />
      <TestEmailForm defaultTo={member.email ?? ""} />
    </div>
  );
}
