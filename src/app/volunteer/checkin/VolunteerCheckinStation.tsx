"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrScanner } from "@/app/checkin/QrScanner";

/**
 * Volunteer sign in/out station (phone-first). Staff scan the volunteer's
 * confirmation QR or type the VOL-… code, then land on that volunteer's screen.
 * Reuses the same QrScanner as patient check-in.
 */
export function VolunteerCheckinStation() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function go(value: string) {
    const v = value.trim().toUpperCase();
    if (v) router.push(`/volunteer/checkin/${encodeURIComponent(v)}`);
  }

  return (
    <div className="mt-6 space-y-6">
      <QrScanner onScan={(text) => go(text)} />

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        OR ENTER MANUALLY
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(code);
        }}
        className="space-y-3"
      >
        <input
          className="w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base uppercase"
          placeholder="Volunteer code (e.g. VOL-MC-2026W-0001)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
        />
        <button
          type="submit"
          className="min-h-tap w-full rounded-lg border border-gray-300 font-medium"
        >
          Look up
        </button>
      </form>
    </div>
  );
}
