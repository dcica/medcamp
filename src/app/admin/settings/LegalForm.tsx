"use client";

import { useState } from "react";
import { updateOrgLegal, type LegalInput } from "./actions";
import type { OrgLegal } from "@/lib/orgSettings";

const AREA = "mt-1 block min-h-[200px] w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs";

/**
 * The organisation's privacy policy and terms, in its own words. Published
 * at /privacy and /terms and linked from the footer as soon as they are
 * saved; blank unpublishes. Plain text with `#` headings and `-` bullets —
 * nothing typed here can become markup on the page.
 */
export function LegalForm({ initial }: { initial: OrgLegal }) {
  const [form, setForm] = useState<LegalInput>({
    privacy: initial.privacy ?? "",
    terms: initial.terms ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: keyof LegalInput) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await updateOrgLegal(form);
      setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Privacy policy and terms</h3>
      <p className="text-xs text-gray-500">
        Published at /privacy and /terms and linked from the footer once saved. Use a line starting
        with # for a heading and - for a bullet; a blank line starts a new paragraph. Say how long
        you keep donor and attendee records.
      </p>
      <label className="block text-sm">
        Privacy policy
        <textarea value={form.privacy} onChange={set("privacy")} className={AREA} />
      </label>
      <label className="block text-sm">
        Terms of service
        <textarea value={form.terms} onChange={set("terms")} className={AREA} />
      </label>
      <button type="submit" disabled={busy} className="inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60">
        {busy ? "Saving…" : "Save policies"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
