"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCamp } from "./actions";

const inputCls =
  "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function CreateCampForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCamp({ name, code, startsAt, endsAt });
      if (res.ok && res.id) router.push(`/admin/camps/${res.id}`);
      else if (!res.ok) setError(res.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        + New camp
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <input
        className={inputCls}
        placeholder="Camp name (e.g. Winter Medical Camp 2026)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={`${inputCls} uppercase`}
        placeholder="Code (MC-2026W)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <label className="block text-sm text-gray-600">
        Starts
        <input
          type="datetime-local"
          className={inputCls}
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </label>
      <label className="block text-sm text-gray-600">
        Ends
        <input
          type="datetime-local"
          className={inputCls}
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
