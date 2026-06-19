"use client";

import { useState } from "react";

/**
 * DEV-ONLY helper: confirms the order via /api/dev/confirm (simulating a paid
 * Stripe webhook) so the flow is testable locally without the Stripe CLI.
 */
export function SimulatePayButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/dev/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const json = await res.json();
    if (json.ok) {
      window.location.reload();
    } else {
      setErr(json.error ?? (json.overCapacity ? "Over capacity" : "Failed"));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={go}
        disabled={busy}
        className="min-h-tap w-full rounded-lg border border-amber-400 bg-amber-50 text-sm font-medium text-amber-800 disabled:opacity-50"
      >
        {busy ? "Confirming…" : "Simulate payment (dev)"}
      </button>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
    </div>
  );
}
