"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signInAction, signOutAction } from "../actions";

/**
 * Volunteer sign in / out buttons. The action shown depends on current state:
 * not-in → Sign in; in but not out → Sign out; out → done. Server enforces the
 * same ordering (can't sign out before signing in).
 */
export function CheckinActions({
  code,
  checkedIn,
  checkedOut,
}: {
  code: string;
  checkedIn: boolean;
  checkedOut: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "Failed.");
    });
  }

  if (checkedOut) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-3 text-center text-sm font-medium text-green-700">
        Signed out ✓ — hours recorded.
      </p>
    );
  }

  return (
    <div>
      {!checkedIn ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => signInAction(code))}
          className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => signOutAction(code))}
          className="min-h-tap w-full rounded-lg bg-gray-800 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Signing out…" : "Sign out"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
