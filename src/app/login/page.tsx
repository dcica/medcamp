import { enabledOidcProviders } from "@/lib/env";
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
      <h1 className="text-2xl font-bold text-brand">Staff sign-in</h1>
      <p className="mt-1 mb-6 text-sm text-gray-600">
        Volunteers and coordinators sign in here. Patients don&apos;t need an
        account — they register from the public portal.
      </p>
      <LoginButtons providers={providers} callbackUrl={callbackUrl || "/dashboard"} />
    </main>
  );
}
