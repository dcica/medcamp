"use client";

import { signIn } from "next-auth/react";

type Provider = { id: string; label: string };

export function LoginButtons({
  providers,
  callbackUrl,
}: {
  providers: Provider[];
  callbackUrl: string;
}) {
  if (providers.length === 0) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No sign-in providers are configured. Set Google/Microsoft/GitHub
        credentials in <code>.env</code> to enable login.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <button
          key={p.id}
          onClick={() => signIn(p.id, { callbackUrl })}
          className="min-h-tap w-full rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50"
        >
          Continue with {p.label}
        </button>
      ))}
    </div>
  );
}
