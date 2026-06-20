import Link from "next/link";
import { enabledOidcProviders } from "@/lib/env";
import { testLoginEnabled } from "@/lib/testAccounts";
import { PageHelp } from "@/app/_components/PageHelp";
import { LoginButtons } from "./LoginButtons";

export const dynamic = "force-dynamic";

/**
 * Sign-in page. Only configured OIDC providers are offered (email/password
 * fallback is deferred per Approach C). After sign-in the user lands on
 * callbackUrl (or the dashboard).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  const providers = [
    { id: "google", label: "Google", on: enabledOidcProviders.google },
    { id: "azure-ad", label: "Microsoft", on: enabledOidcProviders.microsoft },
    { id: "github", label: "GitHub", on: enabledOidcProviders.github },
  ]
    .filter((p) => p.on)
    .map(({ id, label }) => ({ id, label }));

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-screen-sm flex-col justify-center px-4">
      <div className="mb-6">
        <PageHelp
          id="login"
          title="Staff sign-in"
          subtitle="Volunteers and coordinators sign in here. Patients don't need an account — they register from the public portal."
          items={[
            {
              label: "Which button?",
              body: "Use whichever account your organization gave you — Google, Microsoft, or GitHub. Only configured providers are shown.",
            },
            {
              label: "Patients",
              body: "Attendees never sign in. They register from the public link and check in with their QR badge.",
            },
            {
              label: "Access",
              body: "What you can see after signing in depends on the role a coordinator assigned to you.",
            },
          ]}
        />
      </div>
      <LoginButtons providers={providers} callbackUrl={callbackUrl || "/dashboard"} />

      {testLoginEnabled && (
        <p className="mt-6 text-center text-xs text-gray-400">
          <Link
            href={
              callbackUrl
                ? `/test-login?callbackUrl=${encodeURIComponent(callbackUrl)}`
                : "/test-login"
            }
            className="text-brand underline"
          >
            Test sign-in
          </Link>{" "}
          (QA only)
        </p>
      )}
    </main>
  );
}
