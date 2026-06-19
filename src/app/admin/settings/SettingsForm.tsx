"use client";

import { useState, useTransition } from "react";
import { updateOrgSettings } from "./actions";

export function SettingsForm({
  initialName,
  initialBrand,
}: {
  initialName: string;
  initialBrand: string;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState(initialBrand);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateOrgSettings({ name, brand });
      setMsg(res.ok ? "Saved." : res.error);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <label className="block">
        <span className="text-sm text-gray-600">Organization name</span>
        <input
          className="mt-1 w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="text-sm text-gray-600">Brand color</span>
        <div className="mt-1 flex items-center gap-3">
          <input
            type="color"
            className="min-h-tap w-16 rounded border border-gray-300"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            className="min-h-tap flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </div>
  );
}
