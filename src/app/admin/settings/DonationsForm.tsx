"use client";

import { useState } from "react";
import { updateOrgDonations, type DonationsInput } from "./actions";
import type { OrgDonations } from "@/lib/orgSettings";

const FIELD = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

/**
 * The donations door. Off by default; on, the /donate page exists and is
 * linked from the footer, the empty calendar and the home rail. Amounts are
 * typed in dollars here and stored in cents.
 */
export function DonationsForm({ initial }: { initial: OrgDonations }) {
  const [form, setForm] = useState<DonationsInput>({
    enabled: initial.enabled,
    suggestedAmounts: initial.suggestedAmountsCents.map((c) => String(c / 100)).join(", "),
    minDollars: String(initial.minCents / 100),
    allowFeeCover: initial.allowFeeCover,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateOrgDonations(form);
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Donations</h3>
      <p className="text-xs text-gray-500">
        When on, /donate takes gifts to your organisation with a receipt emailed on payment, and the
        footer, the home page and the empty calendar link to it. Gifts carry no platform fee.
      </p>
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        Accept donations on /donate
      </label>
      <label className="block text-sm">
        Suggested amounts ($, comma-separated, up to 8)
        <input
          value={form.suggestedAmounts}
          onChange={(e) => setForm((f) => ({ ...f, suggestedAmounts: e.target.value }))}
          className={FIELD}
          placeholder="25, 50, 100, 250"
        />
      </label>
      <label className="block text-sm">
        Minimum gift ($)
        <input
          value={form.minDollars}
          onChange={(e) => setForm((f) => ({ ...f, minDollars: e.target.value }))}
          className={FIELD}
          inputMode="numeric"
        />
      </label>
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.allowFeeCover}
          onChange={(e) => setForm((f) => ({ ...f, allowFeeCover: e.target.checked }))}
        />
        Offer donors the option to cover your processing cost
      </label>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save donations"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
