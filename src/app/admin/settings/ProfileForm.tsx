"use client";

import { useState } from "react";
import { updateOrgProfile, type ProfileInput } from "./actions";
import type { OrgProfile } from "@/lib/orgSettings";

const TAX_OPTIONS: { value: ProfileInput["taxStatus"]; label: string }[] = [
  { value: "", label: "Not stated" },
  { value: "501c3", label: "501(c)(3) non-profit" },
  { value: "governmental", label: "Governmental unit" },
  { value: "other", label: "Other" },
];

const INPUT = "mt-1 block min-h-tap w-full rounded-md border border-gray-300 px-3 text-sm";

/**
 * The organisation's public identity: who to contact, who mail comes from,
 * and what a receipt may say. Every field is optional; a blank clears it.
 * The receipt sentence is the organisation's own words — the platform never
 * asserts a tax status on anyone's behalf.
 */
export function ProfileForm({ initial }: { initial: OrgProfile }) {
  const [form, setForm] = useState<ProfileInput>({
    contactEmail: initial.contactEmail ?? "",
    senderEmail: initial.senderEmail ?? "",
    legalName: initial.legalName ?? "",
    ein: initial.ein ?? "",
    taxStatus: initial.taxStatus ?? "",
    receiptStatement: initial.receiptStatement ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: keyof ProfileInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateOrgProfile(form);
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Contact, mail and receipts</h3>
      <label className="block text-sm">
        Contact email
        <input type="email" value={form.contactEmail} onChange={set("contactEmail")} className={INPUT} placeholder="events@example.org" />
        <span className="mt-1 block text-xs text-gray-500">Footer link, enquiry pages, and the reply-to on every email.</span>
      </label>
      <label className="block text-sm">
        Sender address
        <input type="text" value={form.senderEmail} onChange={set("senderEmail")} className={INPUT} placeholder="Your Org <no-reply@example.org>" />
        <span className="mt-1 block text-xs text-gray-500">The From address on confirmation emails. Must be verified with the email provider.</span>
      </label>
      <label className="block text-sm">
        Legal name
        <input type="text" value={form.legalName} onChange={set("legalName")} className={INPUT} />
      </label>
      <label className="block text-sm">
        EIN
        <input type="text" value={form.ein} onChange={set("ein")} className={INPUT} placeholder="12-3456789" inputMode="numeric" />
      </label>
      <label className="block text-sm">
        Tax status
        <select value={form.taxStatus} onChange={set("taxStatus")} className={INPUT}>
          {TAX_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-gray-500">Your organisation&apos;s own assertion. Shown on volunteer certificates and receipts.</span>
      </label>
      <label className="block text-sm">
        Receipt statement
        <textarea value={form.receiptStatement} onChange={set("receiptStatement")} className={`${INPUT} min-h-[96px] py-2`} placeholder="No goods or services were provided in exchange for this contribution." />
        <span className="mt-1 block text-xs text-gray-500">Printed on donation receipts, in your words. Leave blank to print none.</span>
      </label>
      <button type="submit" disabled={busy} className="inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60">
        {busy ? "Saving…" : "Save profile"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
