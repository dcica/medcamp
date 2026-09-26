"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrScanner } from "@/app/_components/QrScanner";
import { expandTicketCode } from "@/lib/ticketCode";

/**
 * The CAMP half of the scan station: scan a patient's QR badge or type their
 * camp ID, then land on their check-in screen.
 *
 * WHY THIS NAVIGATES instead of resolving inline, unlike the gate half. Check-in
 * is one person with several steps — payment banner, waiver signature, service
 * chips, badge print, station routing — and it has its OWN role guard
 * (CHECKIN_ROLES in src/app/checkin/actions.ts), which is narrower than the
 * station's. A POS till holder can staff a door but must not be handed a
 * medical waiver form. Keeping the camp back-half behind its own route keeps
 * that guard where it already is, and means a POS till holder who scans a camp
 * code gets a refusal they can read rather than a 403 half way through a flow.
 *
 * The gate half is the opposite shape — many people, seconds each, camera stays
 * live — which is why it stays inline.
 */
export function CampMode({ eventCode }: { eventCode: string | null }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");

  function go(value: string) {
    // The same rule the door uses: a bare token gets this camp's prefix, a
    // value that already contains a hyphen is a whole id and is left alone.
    // Falls back to a plain uppercase when no camp is running, because then
    // there is no prefix to apply and the operator must type the whole thing.
    const v = eventCode
      ? expandTicketCode(eventCode, value)
      : value.trim().toUpperCase() || null;
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
          go(typed);
        }}
        className="space-y-3"
      >
        {/* The prefix is FIXED TEXT, not part of the input. Re-typing
            `MC-2026W-` for every lookup is eight characters of transcription
            risk per patient with a queue waiting — and it is the same
            treatment the gate already gives its own manual entry. */}
        <div className="flex items-stretch rounded-lg border border-gray-300">
          {eventCode && (
            <span className="flex select-none items-center whitespace-nowrap rounded-l-lg bg-gray-100 px-3 font-mono text-sm text-gray-500">
              {eventCode}-
            </span>
          )}
          <input
            className="min-h-tap w-full rounded-r-lg px-3 py-2 text-base uppercase"
            placeholder={eventCode ? "K7M2XQ9T" : "Camp ID (e.g. MC-2026W-K7M2XQ9T)"}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            inputMode="text"
          />
        </div>
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
