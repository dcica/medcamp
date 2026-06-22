"use client";

import { useState, useTransition } from "react";
import { setEventFlags } from "../actions";

type Flags = {
  collectsAttendeeDetails: boolean;
  acceptsDonations: boolean;
  honorsMembership: boolean;
  allowsRefunds: boolean;
};

const ROWS: { key: keyof Flags; label: string; help: string }[] = [
  {
    key: "collectsAttendeeDetails",
    label: "Collect attendee details (patient profiles)",
    help: "On = camp/medcamp form (per-person name, address, services). Off = quantity-only (admission tickets + merch).",
  },
  {
    key: "acceptsDonations",
    label: "Accept donations",
    help: "Shows an optional free-form donation field on the registration form.",
  },
  {
    key: "honorsMembership",
    label: "Honor family membership",
    help: "A family membership admits the party free here; registration shows membership as a compare against admission.",
  },
  {
    key: "allowsRefunds",
    label: "Allow refunds (reschedule override)",
    help: "Off = no refunds, including no-shows. On only if this event may be refunded/rescheduled.",
  },
];

export function EventFlags({ id, initial }: { id: string; initial: Flags }) {
  const [flags, setFlags] = useState<Flags>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await setEventFlags(id, flags);
      setMsg(res.ok ? "Saved." : res.error);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      {ROWS.map((r) => (
        <label key={r.key} className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={flags[r.key]}
            onChange={(e) => setFlags((f) => ({ ...f, [r.key]: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{r.label}</span>
            <span className="block text-xs text-gray-500">{r.help}</span>
          </span>
        </label>
      ))}
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
