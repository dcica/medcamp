"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { computeOrderFees, coverLabel, type FeePolicy } from "@/lib/fees";
import type { OrgDonations } from "@/lib/orgSettings";
import { CheckoutReturnNotice } from "@/app/_components/CheckoutReturnNotice";
import { INPUT_CLASS, ValidatedInput, validateEmail, validateName } from "@/app/_components/ValidatedInput";
import { submitDonation } from "./actions";

const inputCls = INPUT_CLASS;

/**
 * The donate form. One-tap suggested amounts or any whole-dollar amount, a
 * name and an email for the receipt, an optional honoree and note, and — when
 * the organisation offers it — the processing-cost cover, which is the
 * organisation's money and says so. No tip, no pre-ticked surprise: the total
 * line is exactly what Stripe will charge.
 */
export function DonateForm({
  orgName,
  policy,
  feePolicy,
  returnedFromCheckout,
  resumable,
}: {
  orgName: string;
  policy: OrgDonations;
  /** The organisation's fee policy today; null when no cover can be computed. */
  feePolicy: FeePolicy | null;
  returnedFromCheckout: boolean;
  resumable: { orderId: string; amountCents: number } | null;
}) {
  const [amountDollars, setAmountDollars] = useState<string>(
    String(policy.suggestedAmountsCents[0] / 100),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [honoreeName, setHonoreeName] = useState("");
  const [donorNote, setDonorNote] = useState("");
  const [coverFee, setCoverFee] = useState(feePolicy?.feeCoverDefaultChecked ?? false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amountCents = Math.max(0, Math.round((Number(amountDollars) || 0) * 100));
  const coverOffered = policy.allowFeeCover && feePolicy !== null && feePolicy.allowBuyerCover;
  const line = [{ amountCents, quantity: 1, isDonation: true }];
  const fees = computeOrderFees(line, feePolicy, { coverProcessing: coverOffered && coverFee, orgName });
  const coverIfTicked = coverOffered
    ? computeOrderFees(line, feePolicy, { coverProcessing: true, orgName }).coverCents
    : 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitDonation({
        donor: { name, email },
        amountCents,
        coverFee: coverOffered && coverFee,
        honoreeName: honoreeName || undefined,
        donorNote: donorNote || undefined,
        marketingConsent,
      });
      if (res.ok) window.location.href = res.redirectUrl;
      else setError(res.error);
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {returnedFromCheckout && (
        <CheckoutReturnNotice
          resumable={resumable}
          dirty={false}
          routes={
            resumable
              ? { successPath: `/donate/thanks/${resumable.orderId}`, cancelPath: "/donate" }
              : undefined
          }
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your gift</h2>
        <div className="grid grid-cols-2 gap-2">
          {policy.suggestedAmountsCents.map((c) => {
            const selected = amountCents === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setAmountDollars(String(c / 100))}
                className={`min-h-tap rounded-lg border px-3 text-base font-semibold ${
                  selected ? "border-brand bg-brand text-brand-fg" : "border-gray-300 text-gray-800"
                }`}
              >
                {formatCents(c)}
              </button>
            );
          })}
        </div>
        <label className="block text-sm text-gray-600">
          Or another amount ($)
          <input
            type="number"
            min={policy.minCents / 100}
            step="1"
            inputMode="numeric"
            className={inputCls}
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            aria-label="Donation amount in dollars"
          />
        </label>
        <p className="text-xs text-gray-500">Minimum {formatCents(policy.minCents)}. Whole dollars.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">For your receipt</h2>
        <ValidatedInput value={name} onChange={setName} validate={validateName} placeholder="Full name" autoComplete="name" aria-label="Your name" />
        <ValidatedInput value={email} onChange={setEmail} validate={validateEmail} type="email" placeholder="Email" autoComplete="email" aria-label="Your email" />
        <label className="block text-sm text-gray-600">
          In honour of (optional)
          <input className={inputCls} value={honoreeName} onChange={(e) => setHonoreeName(e.target.value)} placeholder="A person or an occasion" />
        </label>
        <label className="block text-sm text-gray-600">
          A note for the organisers (optional)
          <textarea className={`${inputCls} min-h-[4rem]`} value={donorNote} onChange={(e) => setDonorNote(e.target.value)} maxLength={300} />
        </label>
      </section>

      {coverOffered && coverIfTicked > 0 && (
        <label className="flex min-h-tap items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={coverFee}
            onChange={(e) => setCoverFee(e.target.checked)}
          />
          {coverLabel(coverIfTicked, orgName)}
        </label>
      )}

      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
        />
        Keep me posted about {orgName}&apos;s events.
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Total</span>
          <span className="text-lg font-bold">{formatCents(fees.totalCents)}</span>
        </div>
        <button
          type="button"
          disabled={pending || amountCents < policy.minCents}
          onClick={submit}
          className="mt-2 min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending ? "Working…" : "Continue to payment"}
        </button>
        <p className="mt-2 text-xs text-gray-400">
          You will pay on Stripe&apos;s secure page. A receipt from {orgName} is emailed to you once the
          payment clears.
        </p>
      </div>
    </div>
  );
}
