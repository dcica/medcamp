"use client";

import { useEffect, useRef, useState } from "react";

import { primeAudio } from "@/lib/scanTones";
import { isDuplicateDecode, type LastDecode } from "@/lib/scanDebounce";

/**
 * Camera QR scanner (progressive enhancement). Uses html5-qrcode, loaded only
 * when the volunteer opts in (camera permission prompt on start). Manual entry
 * is always available on the parent screen for when the camera is unavailable.
 *
 * Two modes:
 *  - default (single-shot): stops after the first decode — the parent navigates.
 *    Used by medcamp check-in.
 *  - continuous: the camera stays live and emits every decode (debounced so the
 *    same code in-frame doesn't re-fire). Used by the gate so a volunteer can
 *    scan person after person without leaving the camera view.
 *
 * THIS COMPONENT MAKES NO SOUND and renders no verdict. It reports decodes; the
 * station decides what they meant and says so, once the server has answered.
 */
export function QrScanner({
  onScan,
  continuous = false,
}: {
  onScan: (text: string) => void;
  continuous?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  // Keep the latest onScan without restarting the camera on each render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  // Debounce duplicate decodes in continuous mode.
  const lastRef = useRef<LastDecode>({ text: "", at: 0 });

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (decoded: string) => {
            if (stopped) return;
            if (continuous) {
              const now = Date.now();
              // Ignore the same code seen again within the window (still in
              // frame). The rule itself lives in @/lib/scanDebounce so it can be
              // tested without a camera.
              if (isDuplicateDecode(lastRef.current, decoded, now)) return;
              lastRef.current = { text: decoded, at: now };
              // NO SOUND HERE, deliberately. This fires on RAW DECODE, before
              // the server has said anything, so a beep here means only "a QR
              // was legible" — the audio twin of the library's green
              // viewfinder, and it sounded identically for a valid ticket, an
              // unknown code and a competition-fee receipt. The station plays
              // playTone(verdict.tone) once it knows. See src/lib/scanTones.ts.
              onScanRef.current(decoded);
              return;
            }
            // Single-shot: stop the camera, hand off, let the parent navigate.
            stopped = true;
            scanner.stop().catch(() => {});
            onScanRef.current(decoded);
          },
          () => {},
        );
      } catch {
        setError("Couldn't start the camera. Use manual entry below.");
        setActive(false);
      }
    })();

    return () => {
      stopped = true;
      scannerRef.current?.stop().catch(() => {});
    };
  }, [active, continuous]);

  return (
    <div>
      {!active ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setActive(true);
            // iOS starts an AudioContext created outside a user gesture in
            // `suspended`, and throttles rapid create/close cycles. This tap IS
            // the gesture, so the station's tones work on the phones volunteers
            // actually hold.
            primeAudio();
          }}
          className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
        >
          {continuous ? "Start scanning" : "Scan QR with camera"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setActive(false)}
          className="min-h-tap w-full rounded-lg border border-gray-300 text-sm"
        >
          Stop camera
        </button>
      )}
      <div id="qr-reader" className="mt-3 overflow-hidden rounded-lg" />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
