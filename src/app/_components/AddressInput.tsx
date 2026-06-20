"use client";

import { useRef, useState, useTransition } from "react";
import { checkAddress } from "./address-action";

/**
 * Reusable address field with Google address validation. On blur it asks the
 * server to standardize the address and, if Google returns a cleaner version,
 * offers a "Did you mean…" suggestion the user can accept or ignore. It never
 * blocks: if no key is configured or the call fails, it behaves like a plain
 * input. Phone-first (48px taps, single column).
 *
 * Drop-in for any address: pass value/onChange like a controlled input. Future
 * volunteer / vendor / org-onboarding fields should use this instead of a bare
 * <input> so validation is consistent everywhere.
 */
export function AddressInput({
  value,
  onChange,
  placeholder,
  className,
  regionCode = "US",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  regionCode?: string;
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastChecked = useRef<string>("");

  // Compare ignoring case / punctuation / spacing so we only surface a
  // suggestion when it's a real improvement (e.g. an added ZIP), not noise.
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\s,.\-]+/g, " ").trim();

  function runCheck() {
    const v = value.trim();
    if (!v || v === lastChecked.current) return;
    lastChecked.current = v;
    setSuggestion(null);
    setUnverified(false);

    startTransition(async () => {
      const res = await checkAddress(v, regionCode);
      if (!res) return; // no key / failed → stay a plain input
      if (res.formatted && normalize(res.formatted) !== normalize(v)) {
        setSuggestion(res.formatted);
      } else if (!res.confirmed) {
        setUnverified(true);
      }
    });
  }

  function accept() {
    if (!suggestion) return;
    onChange(suggestion);
    lastChecked.current = suggestion.trim();
    setSuggestion(null);
    setUnverified(false);
  }

  return (
    <div>
      <input
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={runCheck}
        autoComplete="street-address"
      />

      {pending && (
        <p className="mt-1 text-xs text-gray-400">Checking address…</p>
      )}

      {suggestion && (
        <div className="mt-2 rounded-lg border border-brand/40 bg-brand/5 p-3 text-sm">
          <p className="text-gray-600">Did you mean:</p>
          <p className="mt-0.5 font-medium text-gray-900">{suggestion}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={accept}
              className="min-h-tap rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg"
            >
              Use suggested
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm text-gray-600"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}

      {unverified && !suggestion && (
        <p className="mt-1 text-xs text-amber-700">
          We couldn&apos;t fully verify this address — mailed labs may be
          delayed. You can still continue.
        </p>
      )}
    </div>
  );
}
