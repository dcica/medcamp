"use client";

import { useState, useTransition } from "react";
import { checkInAction } from "../actions";

/**
 * Check-in button. Enabled only when paid + waiver signed (the server enforces
 * the same guards). On success the page revalidates and shows the badge link.
 */
export function CheckinActions({
  campId,
  ready,
}: {
  campId: string;
  ready: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function checkIn() {
    setError(null);
    startTransition(async () => {
      const res = await checkInAction(campId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={!ready || pending}
        onClick={checkIn}
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Checking in…" : "Check in"}
      </button>
      {!ready && (
        <p className="mt-1 text-xs text-gray-500">
          Requires confirmed payment and a signed waiver.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
