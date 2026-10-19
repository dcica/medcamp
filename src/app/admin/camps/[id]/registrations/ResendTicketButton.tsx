"use client";

import { useState, useTransition } from "react";
import { resendTicketEmailAction } from "./actions";

/** Send the ticket email again, and say whether it reached a provider. */
export function ResendTicketButton({ orderId }: { orderId: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    setNote(null);
    startTransition(async () => {
      const res = await resendTicketEmailAction(orderId);
      if (!res.ok) setNote(res.error);
      else setNote(res.delivered ? "Sent." : "Not delivered — no email provider is configured on this deployment.");
    });
  }

  return (
    <span className="mt-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className="inline-flex min-h-tap items-center rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Resend ticket email"}
      </button>
      {note && (
        <span className="text-xs text-gray-600" role="status">
          {note}
        </span>
      )}
    </span>
  );
}
