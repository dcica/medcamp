"use client";

import { useState, useTransition } from "react";
import { sendTestEmailAction } from "./actions";

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function sendTest() {
    setMsg(null);
    startTransition(async () => {
      const res = await sendTestEmailAction(to);
      if (res.ok) {
        setMsg({
          ok: true,
          text: res.delivered
            ? `Sent to ${to}. Check the inbox (and spam).`
            : "No provider configured — message was logged to the server console instead.",
        });
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <label className="block">
        <span className="text-sm text-gray-600">Send a test email to</span>
        <input
          type="email"
          className="mt-1 w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.org"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={sendTest}
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send test email"}
      </button>
      {msg && (
        <p
          className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
