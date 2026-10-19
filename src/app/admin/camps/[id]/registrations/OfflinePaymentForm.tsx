"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { INPUT_CLASS, ValidatedInput, validateEmail, validateName } from "@/app/_components/ValidatedInput";
import { recordOfflinePaymentAction } from "./actions";
import type { OfflineMethod } from "@/server/offlineOrders";

const inputCls = INPUT_CLASS;

export type OfferingOption = { key: string; name: string; priceCents: number; onsitePriceCents: number | null };

/**
 * Record a payment that arrived outside Stripe and email the ticket. The
 * price shown per item is the advertised one; the server prices the basket
 * from the event's own rows and refuses to confirm if the amount received
 * does not match — that refusal is the point, not an inconvenience.
 */
export function OfflinePaymentForm({
  eventId,
  offerings,
  emailConfigured,
  canRecordCash,
}: {
  eventId: string;
  offerings: OfferingOption[];
  /** Whether a mail provider is configured; without one the ticket is logged, not sent. */
  emailConfigured: boolean;
  /** Till holders only, as at the door; the server refuses it regardless. */
  canRecordCash: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<OfflineMethod>("ZELLE");
  const [channel, setChannel] = useState<"online" | "door">("online");
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const priceOf = (o: OfferingOption) =>
    channel === "door" && o.onsitePriceCents !== null ? o.onsitePriceCents : o.priceCents;
  const expectedCents = offerings.reduce((s, o) => s + priceOf(o) * (quantities[o.key] ?? 0), 0);

  function submit() {
    setResult(null);
    startTransition(async () => {
      const res = await recordOfflinePaymentAction({
        eventId,
        registrant: { name, email, phone },
        items: offerings.map((o) => ({ serviceKey: o.key, quantity: quantities[o.key] ?? 0 })),
        method,
        amountDollars: amount,
        ref,
        channel,
      });
      if (res.ok) {
        setResult({
          ok: true,
          text: res.alreadyConfirmed
            ? `Reference ${ref} was already confirmed; nothing changed.`
            : `Recorded. ${res.campIds.length} code${res.campIds.length === 1 ? "" : "s"} minted` +
              (res.emailDelivered
                ? ` and the ticket email was sent to ${email}.`
                : ` — the ticket email was NOT delivered (no email provider on this deployment); use Resend once one is configured.`),
        });
        setRef("");
        setAmount("");
        setQuantities({});
        router.refresh();
      } else {
        setResult({ ok: false, text: res.message });
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        + Record a Zelle, cheque or cash payment
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Record an offline payment
      </h3>
      {!emailConfigured && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No email provider is configured on this deployment: the order is recorded and the
          code minted, but the ticket email is only logged. Use Resend once a provider is set.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-gray-600">
          Paid by
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as OfflineMethod)}>
            <option value="ZELLE">Zelle</option>
            <option value="CHECK">Cheque</option>
            {canRecordCash && <option value="CASH">Cash</option>}
          </select>
        </label>
        <label className="block text-sm text-gray-600">
          Price charged
          <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as "online" | "door")}>
            <option value="online">Advertised (online)</option>
            <option value="door">Door</option>
          </select>
        </label>
      </div>
      <label className="block text-sm text-gray-600">
        Payment reference (Zelle confirmation, cheque number, receipt number)
        <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Unique per payment — a repeat is refused" />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm text-gray-600">What they paid for</legend>
        {offerings.map((o) => {
          const qty = quantities[o.key] ?? 0;
          return (
            <div key={o.key} className="flex min-h-tap items-center justify-between gap-3 text-sm">
              <span>
                {o.name} <span className="text-gray-500">{formatCents(priceOf(o))}</span>
              </span>
              <span className="flex items-center gap-2">
                <button type="button" aria-label={`Remove one ${o.name}`} className="h-9 w-9 rounded-lg border border-gray-300 text-lg font-bold" disabled={qty === 0} onClick={() => setQuantities((q) => ({ ...q, [o.key]: Math.max(0, qty - 1) }))}>−</button>
                <span className="w-6 text-center font-semibold">{qty}</span>
                <button type="button" aria-label={`Add one ${o.name}`} className="h-9 w-9 rounded-lg border border-gray-300 text-lg font-bold" onClick={() => setQuantities((q) => ({ ...q, [o.key]: qty + 1 }))}>+</button>
              </span>
            </div>
          );
        })}
        <p className="text-xs text-gray-500">Basket at these prices: {formatCents(expectedCents)}. The server prices it again and refuses a mismatch.</p>
      </fieldset>

      <label className="block text-sm text-gray-600">
        Amount received ($)
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(expectedCents / 100).toFixed(2)} />
      </label>

      <div className="space-y-2">
        <ValidatedInput value={name} onChange={setName} validate={validateName} placeholder="Buyer's name" autoComplete="off" aria-label="Buyer's name" />
        <ValidatedInput value={email} onChange={setEmail} validate={validateEmail} type="email" placeholder="Buyer's email (the ticket goes here)" autoComplete="off" aria-label="Buyer's email" />
        <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" aria-label="Buyer's phone" />
      </div>

      {result && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role="status">
          {result.text}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={submit} className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50">
          {pending ? "Recording…" : "Record and email the ticket"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm">
          Close
        </button>
      </div>
    </div>
  );
}
