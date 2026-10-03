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
 *
 * WHY THE CAMERA SEQUENCE IS TRACED. The start path used to be one `try` with a
 * bare `catch {}` and a single sentence — "Couldn't start the camera" — which
 * is the same message whether permission was refused, the device has no rear
 * camera, another app holds the lens, or the library chunk failed to download.
 * At a door, with a queue, that is unactionable; on 2026-09-27 it cost an
 * evening of guessing. Every step now leaves a breadcrumb, the real
 * `DOMException.name` reaches the screen, and the trail is posted ONCE to
 * /api/client-error so it survives in `/admin/errors` after the volunteer has
 * put the phone down.
 */

/** DOMException names getUserMedia actually throws, in words a volunteer can act on. */
function cameraAdvice(name: string): string {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was refused — allow it for this site, then tap again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera on this device.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "No back camera on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is being used by another app — close it and tap again.";
    case "SecurityError":
      return "The camera needs a secure (https) connection.";
    case "AbortError":
      return "The camera stopped before it started — tap again.";
    default:
      return "Couldn't start the camera.";
  }
}

export function QrScanner({
  onScan,
  continuous = false,
  onActiveChange,
  fill = false,
}: {
  onScan: (text: string) => void;
  continuous?: boolean;
  /**
   * Reports whether the camera is actually running.
   *
   * The gate draws its own status chip, and without this it had no way to
   * know — so it reported the LATCH phase instead and said "Scanning" while
   * the camera had never been started. A volunteer held up a ticket, nothing
   * happened, and the screen insisted it was working. Reported 2026-10-03.
   */
  onActiveChange?: (active: boolean) => void;
  /**
   * Fill the parent instead of sitting in page flow. The gate puts this
   * inside a dark viewfinder where the default brand-navy button is nearly
   * invisible and only a few pixels tall.
   */
  fill?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The raw `DOMException.name: message`, shown small under the advice. A
  // volunteer cannot act on it, but they CAN read it down the phone to whoever
  // is fixing it, which is the whole point on an event night.
  const [detail, setDetail] = useState<string | null>(null);

  // Tell the parent what the camera is ACTUALLY doing. The gate's status chip
  // used to infer it from the latch phase, which knows nothing about whether
  // the stream ever started.
  const activeRef = useRef(onActiveChange);
  activeRef.current = onActiveChange;
  useEffect(() => {
    activeRef.current?.(active);
  }, [active]);
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  // Keep the latest onScan without restarting the camera on each render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  // Debounce duplicate decodes in continuous mode.
  const lastRef = useRef<LastDecode>({ text: "", at: 0 });

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    // ONE report per attempt, not one per step. /api/client-error allows 10
    // posts per minute PER IP, and eight volunteers on one hall WiFi share a
    // single NAT address — a chatty tracer would rate-limit itself out of
    // existence exactly when several phones are failing at once.
    const t0 = Date.now();
    const trail: string[] = [];
    const mark = (s: string) => {
      trail.push(`+${Date.now() - t0}ms ${s}`);
      // Live view for anyone with devtools open; the POST is for afterwards.
      console.info(`[qr] ${s}`);
    };
    const report = (outcome: string) => {
      const message = `camera ${outcome} | ${trail.join(" | ")}`.slice(0, 500);
      // Fire-and-forget, keepalive so it survives the page being put away, and
      // .catch() because a crash reporter that throws is worse than none.
      void fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        keepalive: true,
      }).catch(() => {});
    };
    const nameOf = (e: unknown) =>
      e && typeof e === "object" && "name" in e
        ? String((e as { name: unknown }).name)
        : "Error";
    const msgOf = (e: unknown) =>
      e instanceof Error ? e.message : String(e ?? "");

    (async () => {
      mark(`tap mode=${continuous ? "continuous" : "single"}`);
      // Checked and reported BEFORE the library loads, because both produce a
      // failure that looks identical to "permission denied" further down.
      mark(
        `ctx secure=${typeof window !== "undefined" && window.isSecureContext}` +
          ` md=${!!navigator.mediaDevices}`,
      );

      let Html5Qrcode: typeof import("html5-qrcode").Html5Qrcode;
      try {
        ({ Html5Qrcode } = await import("html5-qrcode"));
        mark("import ok");
      } catch (e) {
        // A chunk that 404s or is blocked leaves the camera untouched, so
        // without this it reads as a camera fault and sends people to settings.
        mark(`import FAIL ${nameOf(e)}`);
        setError("Scanner failed to load. Use manual entry below.");
        setActive(false);
        report("import-failed");
        return;
      }

      // Which cameras exist at all. An OverconstrainedError below is only
      // meaningful next to this count: zero means no camera, one usually means
      // a laptop with a front camera and no `environment` to satisfy.
      try {
        const cams = await Html5Qrcode.getCameras();
        mark(`cams n=${cams.length}`);
      } catch (e) {
        mark(`cams FAIL ${nameOf(e)}`);
      }

      try {
        const scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;
        const onDecode = buildOnDecode();
        try {
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 220 },
            onDecode,
            () => {},
          );
          mark("started env");
        } catch (e) {
          // A device with no REAR camera is the single most common cause, and
          // it is not a failure worth showing a volunteer: a laptop front
          // camera reads a QR held up to it perfectly well. Retry unconstrained
          // before giving up, and record that we had to.
          mark(`env FAIL ${nameOf(e)}: ${msgOf(e).slice(0, 60)}`);
          await scanner.start(
            {},
            { fps: 10, qrbox: 220 },
            onDecode,
            () => {},
          );
          mark("started any");
          report("ok-after-fallback");
        }
      } catch (e) {
        mark(`start FAIL ${nameOf(e)}: ${msgOf(e).slice(0, 60)}`);
        setError(`${cameraAdvice(nameOf(e))} Use manual entry below.`);
        setDetail(`${nameOf(e)}: ${msgOf(e)}`.slice(0, 200));
        setActive(false);
        report("failed");
      }
    })();

    /** The decode handler, unchanged — lifted out so both start attempts share it. */
    function buildOnDecode() {
      return (decoded: string) => {
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
        scannerRef.current?.stop().catch(() => {});
        onScanRef.current(decoded);
      };
    }

    return () => {
      stopped = true;
      scannerRef.current?.stop().catch(() => {});
    };
  }, [active, continuous]);

  return (
    <div className={fill ? "absolute inset-0" : undefined}>
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
          className={
            fill
              ? // THE WHOLE SURFACE IS THE BUTTON. In the gate this sits on a
                // near-black viewfinder, where the brand navy of the default
                // styling is all but invisible and only 48px tall at the top
                // of a tall box — which is how it came to be missed entirely.
                "absolute inset-0 flex flex-col items-center justify-center gap-2 text-white"
              : "min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
          }
        >
          {fill ? (
            <>
              <span aria-hidden className="text-5xl leading-none">
                ⃞
              </span>
              <span className="text-lg font-bold">
                {continuous ? "Tap to start the camera" : "Scan QR with camera"}
              </span>
              <span className="text-sm text-gray-300">
                The camera is off until you tap
              </span>
            </>
          ) : continuous ? (
            "Start scanning"
          ) : (
            "Scan QR with camera"
          )}
        </button>
      ) : (
        !fill && (
          <button
            type="button"
            onClick={() => setActive(false)}
            className="min-h-tap w-full rounded-lg border border-gray-300 text-sm"
          >
            Stop camera
          </button>
        )
      )}
      <div
        id="qr-reader"
        className={
          fill ? "absolute inset-0 overflow-hidden" : "mt-3 overflow-hidden rounded-lg"
        }
      />
      {error && (
        <div className="mt-2">
          <p className="text-sm text-red-600">{error}</p>
          {detail && (
            <p className="mt-1 break-all font-mono text-xs text-gray-500">
              {detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
