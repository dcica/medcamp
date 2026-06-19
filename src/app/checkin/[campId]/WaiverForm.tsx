"use client";

import { useState, useTransition } from "react";
import { signWaiverAction } from "../actions";

const WAIVER_TEXT = `I consent to participate in the screening services I registered for at this event. I understand these are screening services only, not a substitute for ongoing medical care, and that results requiring follow-up will be communicated to me. I release the organizing non-profit and its volunteers from liability for the free services provided.`;

/**
 * Digital waiver. The patient (or volunteer on their behalf) reads and signs;
 * we record consent + timestamp. No clinical content is captured (No-PHI rule).
 */
export function WaiverForm({ campId }: { campId: string }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sign() {
    setError(null);
    startTransition(async () => {
      const res = await signWaiverAction(campId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Waiver
      </h2>
      <p className="mt-2 max-h-40 overflow-y-auto text-sm text-gray-700">
        {WAIVER_TEXT}
      </p>
      <label className="mt-3 flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        I have read and agree to the waiver.
      </label>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={!agreed || pending}
        onClick={sign}
        className="mt-3 min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Signing…" : "Sign waiver"}
      </button>
    </div>
  );
}
