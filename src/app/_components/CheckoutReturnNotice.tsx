"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { resumeCheckout } from "./checkout-action";
import type { CheckoutRoutes } from "@/lib/checkoutReturn";

/**
 * What a buyer sees after tapping Stripe Checkout's own back link.
 *
 * THE ONE THING THIS SCREEN HAS TO SAY is "nothing was charged". That is the
 * question the buyer actually has, and before this existed the page answered it
 * with a blank form and silence. Everything else here is secondary.
 *
 * The copy deliberately does not say the order was cancelled — it was not.
 * Backing out of a hosted Checkout page is declining to pay YET, and the order
 * is still sitting there payable, which is the whole reason resuming works.
 * It also does not open with "You came back without paying": true, and it reads
 * as a telling-off aimed at someone who has done nothing wrong.
 */

type Props = {
  /**
   * The order Stripe returned them from, present only when the server verified
   * the resume cookie against it. Absent ⇒ sentence only, no button.
   */
  resumable: { orderId: string; amountCents: number } | null;
  /**
   * True once the buyer has touched any field. See below — this is what stops
   * the button charging yesterday's price for today's form.
   */
  dirty: boolean;
  routes?: CheckoutRoutes;
};

export function CheckoutReturnNotice({ resumable, dirty, routes }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  /**
   * The resume button disappears the moment the form is edited, and that is a
   * correctness rule, not a tidiness one.
   *
   * The button pays the EXISTING order at the EXISTING price. The buyer's most
   * likely next move on this screen is to change something — add an attendee,
   * fix the participant count — and the total below updates while the order's
   * does not. Leaving the button up would offer "pay $25" under a form reading
   * $40, and whichever number they end up charged is the wrong one. Once they
   * edit, the honest path is the normal submit, which creates a fresh order at
   * the price actually on screen.
   *
   * The label carries the same load: "for your earlier order" so that even
   * before any edit it cannot be misread as "pay for what is below".
   */
  const canResume = resumable !== null && !dirty;

  async function onResume() {
    if (!resumable) return;
    setError(null);
    setWorking(true);
    const result = await resumeCheckout(resumable.orderId, routes);
    if (!result.ok) {
      setWorking(false);
      setError(result.error);
      return;
    }
    window.location.href = result.redirectUrl;
  }

  return (
    // Amber, and deliberately outside the tenant theme — same reasoning as the
    // STATUS_STYLE carve-out in CLAUDE.md. This colour is meaning ("read this,
    // nothing is broken"), not brand identity, and a tenant whose brand colour
    // is red would turn a reassurance into an alarm.
    <div
      role="status"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p>
        <strong className="font-semibold">
          Nothing was charged — your details are still here.
        </strong>{" "}
        Nothing is held until payment goes through.
      </p>

      {canResume && (
        <button
          type="button"
          onClick={onResume}
          disabled={working}
          className="mt-3 flex min-h-tap w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-50"
        >
          {working
            ? "Taking you to payment…"
            : `Finish paying for your earlier order — ${formatCents(resumable.amountCents)}`}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
