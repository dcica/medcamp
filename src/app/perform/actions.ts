"use server";

import { ZodError } from "zod";
import { createCheckoutForOrder, confirmOrderPaid } from "@/server/payments";
import { setResumeCookie } from "@/server/resumeCookie";
import { guard } from "@/server/requestGuard";
import {
  beginSongUpload,
  chooseOfflineDelivery,
  completeSongUpload,
  createPerformanceEntry,
  type PerformanceEntryInput,
  type UploadTicket,
} from "@/server/performance";

/**
 * Public actions for competition entry and song upload.
 *
 * Mirrors src/app/register/actions.ts deliberately — same result shape, same
 * error-flattening — because both are the same kind of surface: an anonymous
 * buyer on a phone who needs a sentence they can act on, never a stack trace.
 */

export type EntryResult =
  /** `orderId` is echoed back so the form can key its draft to this attempt —
   *  see src/lib/checkoutDraft.ts and the cancel-return flow. */
  | { ok: true; redirectUrl: string; orderId: string }
  | { ok: false; error: string };

export type UploadResult =
  | { ok: true; ticket: UploadTicket }
  | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Identical in intent to register/actions.ts:toBuyerMessage. Duplicated rather
 * than shared because that one is documented against ITS schema's copy, and a
 * shared helper would invite one call site's needs to reshape the other's
 * wording. If a third appears, lift it then.
 */
function toEntrantMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const messages = [...new Set(err.issues.map((i) => i.message))];
    if (messages.length === 0) return "Please check your details and try again.";
    if (messages.length === 1) return `${messages[0]}.`;
    return `Please check your details: ${messages.join("; ")}.`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

/**
 * Submit an entry. Creates a PENDING order, then hands off to hosted Checkout.
 * The webhook — not this action — is what confirms the entry (decision #2), so
 * nothing downstream sees the group until the fee lands.
 */
export async function submitPerformanceEntry(
  input: PerformanceEntryInput,
): Promise<EntryResult> {
  try {
    await guard("entry", 10, 600);
    const { orderId, totalCents } = await createPerformanceEntry(input);

    // A $0 entry is possible if a coordinator prices the fee at zero (a free
    // showcase). Confirm directly — createCheckoutForOrder rejects $0 totals.
    if (totalCents === 0) {
      await confirmOrderPaid(orderId, {
        method: "CASH",
        idempotencyKey: `free-${orderId}`,
      });
      // Free entry: no Stripe hop, but the song step still comes first.
      return { ok: true, redirectUrl: `/perform/after-payment/${orderId}`, orderId };
    }

    // Land on the song step first, then the confirmation — see
    // src/app/perform/after-payment/[orderId]/page.tsx for why that ordering.
    // The receipt code does not exist yet (confirmOrder assigns it), so the
    // return URL is keyed on the order id.
    // Base paths only — buildCheckoutReturn appends `event=` and `cancelled=`.
    // This used to hand-write the cancel query, which is how the app ended up
    // with a `cancelled` param that two call sites produced and nobody read.
    const { url, resumeProof } = await createCheckoutForOrder(orderId, {
      successPath: `/perform/after-payment/${orderId}`,
      cancelPath: "/perform",
    });
    // Must be set on THIS response — it is what lets the entrant finish paying
    // if they back out of Stripe, including from a tab they later close.
    await setResumeCookie(resumeProof);
    return { ok: true, redirectUrl: url, orderId };
  } catch (err) {
    return { ok: false, error: toEntrantMessage(err) };
  }
}

/** Mint a signed upload URL for a paid entry. */
export async function requestSongUpload(code: string): Promise<UploadResult> {
  try {
    await guard("upload-begin", 20, 600);
    const ticket = await beginSongUpload(code);
    return { ok: true, ticket };
  } catch (err) {
    return { ok: false, error: toEntrantMessage(err) };
  }
}

/**
 * Record a finished upload. Verifies with the storage provider that the object
 * actually exists and is within the size limit — the browser uploaded directly,
 * so its success report is a claim and nothing more.
 */
export async function finishSongUpload(code: string): Promise<SimpleResult> {
  try {
    await guard("upload-finish", 20, 600);
    await completeSongUpload(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toEntrantMessage(err) };
  }
}

/** Escape hatch: wrong format, too large, or the phone will not cooperate. */
export async function switchToOfflineDelivery(
  code: string,
): Promise<SimpleResult> {
  try {
    await guard("offline", 20, 600);
    await chooseOfflineDelivery(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toEntrantMessage(err) };
  }
}
