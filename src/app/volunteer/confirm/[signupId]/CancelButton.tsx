"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVolunteerSignup } from "../../actions";

/** Volunteer-facing "can't make it" — frees the slot and promotes a waitlister. */
export function CancelButton({ signupId }: { signupId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelVolunteerSignup(signupId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="no-print">
      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={cancel}
            className="min-h-tap flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Cancelling…" : "Yes, cancel my spot"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-tap flex-1 rounded-lg border border-gray-300 text-sm"
          >
            Keep my spot
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-tap w-full text-sm text-gray-500 underline"
        >
          Can&apos;t make it? Release my spot
        </button>
      )}
    </div>
  );
}
