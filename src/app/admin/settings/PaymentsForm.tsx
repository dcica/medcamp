"use client";

import { useState } from "react";
import { updateOrgPayments, type PaymentsInput } from "./actions";
import type { OrgPayments } from "@/lib/orgSettings";

const FIELD = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

/**
 * Bank debits (ACH) alongside cards. Off by default. Needs the capability on
 * the organisation's Stripe account too (the Payments card above says
 * whether it has it); without both, Checkout offers cards only.
 */
export function PaymentsForm({ initial, achCapable }: { initial: OrgPayments; achCapable: boolean }) {
  const [form, setForm] = useState<PaymentsInput>({
    achEnabled: initial.ach.enabled,
    cutoffBusinessDays: String(initial.ach.cutoffBusinessDays),
    achOnlyAboveDollars: initial.ach.achOnlyAboveCents === null ? "" : String(initial.ach.achOnlyAboveCents / 100),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateOrgPayments(form);
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Bank debits (ACH)</h3>
      <p className="text-xs text-gray-500">
        Offer bank transfer beside card at checkout. A debit takes up to four business days to
        clear and can still fail, so it is switched off automatically before an event starts; a
        seat is held while it clears and released if it bounces. Stripe charges 0.8% capped at $5
        on a debit instead of 2.9%, which is why a booth fee or a sponsorship can be marked
        bank-only on its offering.
        {!achCapable && " Your Stripe account does not have the bank-debit capability yet: enable it in your Stripe dashboard, or Checkout stays card-only."}
      </p>
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.achEnabled}
          onChange={(e) => setForm((f) => ({ ...f, achEnabled: e.target.checked }))}
        />
        Accept bank debits online
      </label>
      <label className="block text-sm">
        Stop taking bank debits this many business days before an event starts
        <input
          value={form.cutoffBusinessDays}
          onChange={(e) => setForm((f) => ({ ...f, cutoffBusinessDays: e.target.value }))}
          className={FIELD}
          inputMode="numeric"
        />
      </label>
      <label className="block text-sm">
        Orders over this amount are bank-only ($, blank for none)
        <input
          value={form.achOnlyAboveDollars}
          onChange={(e) => setForm((f) => ({ ...f, achOnlyAboveDollars: e.target.value }))}
          className={FIELD}
          inputMode="decimal"
          placeholder="e.g. 1000"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save bank debits"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
