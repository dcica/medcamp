"use client";

import { useState, useTransition } from "react";

type AccountOption = { username: string; label: string };

/**
 * Test login form. Posts to /api/test-login (which sets the session cookie), then
 * hard-navigates to the callback URL so the new session is picked up server-side.
 * A datalist offers the known role usernames; the password is shared (env).
 */
export function TestLoginForm({
  accounts,
  callbackUrl,
}: {
  accounts: AccountOption[];
  callbackUrl: string;
}) {
  const [username, setUsername] = useState(accounts[0]?.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inputCls =
    "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/test-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = callbackUrl;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Sign-in failed.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">
          Role username
        </label>
        <input
          className={inputCls}
          list="test-accounts"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="coordinator"
          autoCapitalize="none"
        />
        <datalist id="test-accounts">
          {accounts.map((a) => (
            <option key={a.username} value={a.username}>
              {a.label}
            </option>
          ))}
        </datalist>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">
          Test password
        </label>
        <input
          className={inputCls}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="shared test password"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={pending || !username || !password}
        onClick={submit}
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <details className="mt-2 text-xs text-gray-500">
        <summary className="cursor-pointer">Available role usernames</summary>
        <ul className="mt-2 space-y-1">
          {accounts.map((a) => (
            <li key={a.username}>
              <code className="rounded bg-gray-100 px-1">{a.username}</code> —{" "}
              {a.label}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
