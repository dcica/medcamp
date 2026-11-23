"use client";

import { useState } from "react";
import { updateOrgSite, type SiteInput } from "./actions";
import type { OrgSite } from "@/lib/orgSettings";

const INPUT = "mt-1 block min-h-tap w-full rounded-md border border-gray-300 px-3 text-sm";

/**
 * Analytics and search verification, per organisation. Both are opt-in: a
 * blank id means no analytics script is emitted on this organisation's pages
 * at all, which is the default for a self-hoster and the privacy policy's
 * claim.
 */
export function SiteForm({ initial }: { initial: OrgSite }) {
  const [form, setForm] = useState<SiteInput>({
    gaMeasurementId: initial.gaMeasurementId ?? "",
    gaApiSecret: initial.gaApiSecret ?? "",
    googleSiteVerification: initial.googleSiteVerification ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: keyof SiteInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateOrgSite(form);
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Analytics and search</h3>
      <label className="block text-sm">
        Google Analytics measurement id
        <input type="text" value={form.gaMeasurementId} onChange={set("gaMeasurementId")} className={INPUT} placeholder="G-XXXXXXXXXX" />
        <span className="mt-1 block text-xs text-gray-500">Blank means no analytics script on your pages. Staff screens are never reported.</span>
      </label>
      <label className="block text-sm">
        Measurement Protocol API secret
        <input type="password" value={form.gaApiSecret} onChange={set("gaApiSecret")} className={INPUT} autoComplete="off" />
        <span className="mt-1 block text-xs text-gray-500">Lets confirmed orders be reported as purchases. Needs the id above too.</span>
      </label>
      <label className="block text-sm">
        Search Console verification token
        <input type="text" value={form.googleSiteVerification} onChange={set("googleSiteVerification")} className={INPUT} />
        <span className="mt-1 block text-xs text-gray-500">The content of the HTML-tag method. DNS verification needs nothing here.</span>
      </label>
      <button type="submit" disabled={busy} className="inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60">
        {busy ? "Saving…" : "Save analytics"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
