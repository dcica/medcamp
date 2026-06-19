"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrScanner } from "./QrScanner";

/**
 * Check-in station entry (phone-first). Volunteer either scans a patient's QR
 * badge or types the camp ID, then lands on the attendee's check-in screen.
 */
export function CheckinStation() {
  const router = useRouter();
  const [campId, setCampId] = useState("");

  function go(value: string) {
    const v = value.trim().toUpperCase();
    if (v) router.push(`/checkin/${encodeURIComponent(v)}`);
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
          go(campId);
        }}
        className="space-y-3"
      >
        <input
          className="w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base uppercase"
          placeholder="Camp ID (e.g. MC-2026W-0001)"
          value={campId}
          onChange={(e) => setCampId(e.target.value)}
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
