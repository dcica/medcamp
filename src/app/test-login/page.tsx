import { notFound } from "next/navigation";
import { testLoginEnabled, TEST_ACCOUNTS } from "@/lib/testAccounts";
import { TestLoginForm } from "./TestLoginForm";

export const dynamic = "force-dynamic";

/**
 * TEST-ONLY login screen. 404s entirely unless TEST_LOGIN_ENABLED=true, so it
 * doesn't exist on a normal production build. Lists the available test usernames
 * (the shared password is supplied by whoever enabled it).
 */
export default async function TestLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (!testLoginEnabled) notFound();
  const { callbackUrl } = await searchParams;

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-screen-sm flex-col justify-center px-4">
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong>Test login.</strong> This screen bypasses real sign-in and is for
        QA / demos only. It should never be enabled on a production tenant.
      </div>

      <h1 className="text-2xl font-bold text-brand">Test sign-in</h1>
      <p className="mt-1 mb-6 text-sm text-gray-600">
        Pick a role username and enter the shared test password.
      </p>

      <TestLoginForm
        accounts={TEST_ACCOUNTS.map((a) => ({
          username: a.username,
          label: a.label,
        }))}
        callbackUrl={callbackUrl || "/dashboard"}
      />
    </main>
  );
}
