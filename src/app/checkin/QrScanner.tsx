"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera QR scanner (progressive enhancement). Uses html5-qrcode, loaded only
 * when the volunteer opts in (camera permission prompt on start). Manual entry
 * is always available on the parent screen for when the camera is unavailable.
 *
 * Two modes:
 *  - default (single-shot): stops after the first decode — the parent navigates.
 *    Used by medcamp check-in.
 *  - continuous: the camera stays live and emits every decode (debounced so the
 *    same code in-frame doesn't re-fire), beeping each time. Used by the gate so
 *    a volunteer can scan person after person without leaving the camera view.
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
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

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
              const last = lastRef.current;
              // Ignore the same code seen again within 3s (still in frame).
              if (decoded === last.text && now - last.at < 3000) return;
              lastRef.current = { text: decoded, at: now };
              beep();
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

/** Short confirmation beep via WebAudio (no asset to load). Best-effort. */
function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* audio not available — silent is fine */
  }
}
