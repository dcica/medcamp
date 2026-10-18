"use client";

import { useState } from "react";
import { connectStripe } from "./stripe/actions";

export type StripeCardProps = {
  state: "none" | "incomplete" | "connected";
  accountId: string | null;
  payoutsEnabled: boolean;
  achEnabled: boolean;
};

const BUTTON = "inline-flex min-h-tap items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-60";

/**
 * The organisation's own Stripe account. Three states: nothing connected
 * yet; an account exists but Stripe has not enabled charges (onboarding
 * unfinished, or a requirement later missing); connected and charging. The
 * button hands the coordinator to Stripe's hosted onboarding and comes back
 * through /admin/settings/stripe/return.
 */
export function StripeCard({ state, accountId, payoutsEnabled, achEnabled }: StripeCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await connectStripe();
      if (res.ok) window.location.href = res.url;
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Payments</h3>
      {state === "none" && (
        <>
          <p className="mt-2 text-sm text-gray-600">
            Ticket and donation money settles in your organisation&apos;s own Stripe account. Connect
            one (or create it) with Stripe&apos;s guided setup; it takes about ten minutes and your
            bank details go to Stripe, never to us.
          </p>
          <button type="button" onClick={go} disabled={busy} className={`${BUTTON} mt-4`}>
            {busy ? "Opening Stripe…" : "Connect Stripe"}
          </button>
        </>
      )}
      {state === "incomplete" && (
        <>
          <p className="mt-2 text-sm text-gray-600">
            Your Stripe account <span className="font-mono text-xs">{accountId}</span> exists, but
            Stripe has not enabled charges on it yet — setup is unfinished or a requirement is
            missing. Online sales stay off until it is.
          </p>
          <button type="button" onClick={go} disabled={busy} className={`${BUTTON} mt-4`}>
            {busy ? "Opening Stripe…" : "Continue onboarding"}
          </button>
        </>
      )}
      {state === "connected" && (
        <>
          <p className="mt-2 text-sm text-gray-600">
            <span className="font-semibold text-green-700">Connected.</span> Charges are enabled on{" "}
            <span className="font-mono text-xs">{accountId}</span>. Payouts{" "}
            {payoutsEnabled ? "are enabled" : "are not enabled yet"}; bank debits (ACH){" "}
            {achEnabled ? "are enabled" : "are off"} — both are managed in your Stripe dashboard.
          </p>
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-tap items-center text-sm text-brand underline"
          >
            Open your Stripe dashboard
          </a>
        </>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
