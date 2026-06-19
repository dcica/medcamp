"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera QR scanner (progressive enhancement). Uses html5-qrcode, loaded only
 * when the volunteer opts in (camera permission prompt on start). Manual entry
 * is always available on the parent screen for when the camera is unavailable.
 */
export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);

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
            if (!stopped) {
              stopped = true;
              scanner.stop().catch(() => {});
              onScan(decoded);
            }
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
  }, [active, onScan]);

  return (
    <div>
      {!active ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setActive(true);
          }}
          className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
        >
          Scan QR with camera
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
