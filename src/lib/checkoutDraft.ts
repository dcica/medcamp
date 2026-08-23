/**
 * The typed-but-unpaid form, kept across the hop out to Stripe and back.
 *
 * SCOPE — this is a convenience for REFILLING A FORM and nothing else. It
 * carries no money and grants no authority. Whether the buyer may resume paying
 * an existing order, and what that order costs, are answered server-side from
 * the signed cookie in src/lib/checkoutResume.ts. An earlier design used the
 * draft as the ownership proof; that version could not help a buyer whose tab
 * had closed, which is a large share of the people it was written for.
 *
 * sessionStorage, not localStorage: it is scoped to the tab, survives the
 * same-tab navigation out to Stripe and back, and dies when the tab does. Name,
 * email and phone therefore never outlive the visit, which matters because this
 * is unauthenticated buyer PII sitting in a browser store.
 *
 * Dependency-free (no React, no Prisma) so the forms, the notice component and
 * scripts/verify-checkout.ts all exercise the same code.
 */

/**
 * Bump when the stored shape changes. A draft written by an older deploy is
 * DISCARDED rather than migrated — it is one form fill, and rehydrating a stale
 * shape into a payment form is a worse outcome than an empty field.
 */
export const DRAFT_VERSION = 1;

export type CheckoutDraft<T> = {
  v: number;
  /** The event the draft was typed against. Guards against cross-event bleed. */
  eventId: string;
  /** The order this draft was submitted as, for matching against ?cancelled=. */
  orderId: string;
  values: T;
};

/** sessionStorage is absent in SSR and can throw outright in locked-down/private modes. */
function store(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveDraft<T>(
  key: string,
  draft: Omit<CheckoutDraft<T>, "v">,
): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ ...draft, v: DRAFT_VERSION }));
  } catch {
    // Quota, private mode, whatever. A missing draft is a blank form, not a
    // broken checkout — never let this throw into the submit path.
  }
}

/**
 * Read the draft for `eventId`. Returns null — NEVER throws — for every failure:
 * absent, unparseable, written by another version, or typed against a different
 * event. That last one is not paranoia: /register and /perform both fall back to
 * "the soonest-ending open event" when no ?event= is supplied, so a stale draft
 * really can meet a different event's form, and half-filling one event's
 * checkout with another's details is worse than showing nothing.
 */
export function loadDraft<T>(key: string, eventId: string): CheckoutDraft<T> | null {
  const s = store();
  if (!s) return null;

  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutDraft<T>>;
    if (parsed?.v !== DRAFT_VERSION) return null;
    if (parsed.eventId !== eventId) return null;
    if (typeof parsed.orderId !== "string" || !parsed.orderId) return null;
    if (parsed.values === undefined || parsed.values === null) return null;
    return parsed as CheckoutDraft<T>;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // Same reasoning as saveDraft.
  }
}

/**
 * Serialise a form's values for comparison. Not for storage — `saveDraft` does
 * its own encoding; this exists so "has the buyer edited anything" is one
 * definition rather than one per form.
 */
export function snapshot(values: unknown): string {
  return JSON.stringify(values);
}

/**
 * Has the buyer changed anything since the page settled?
 *
 * Lifted out of the two forms so it can be asserted at all — the rule it
 * encodes is about money. The cancel-return banner offers to finish paying the
 * EXISTING order at the EXISTING price, and the buyer's most likely next move
 * is to edit the form. Once they do, the order's total and the form's total
 * have diverged and the offer has to be withdrawn, or they are shown "pay $25"
 * under a basket reading $40.
 *
 * A null baseline means the page has not settled yet, which is NOT the same as
 * "no edits" — the caller must set a baseline on mount even when there was no
 * draft to restore. Getting that wrong is how the tab-loss path (valid cookie,
 * no draft) kept offering a stale amount over a form typed from scratch; see
 * the structural rows in scripts/verify-checkout.ts §8.
 */
export function hasEdits(baseline: string | null, values: unknown): boolean {
  if (baseline === null) return false;
  return snapshot(values) !== baseline;
}

/** One key per flow, so /register and /perform never overwrite each other. */
export const DRAFT_KEY = {
  register: "dcica.draft.register",
  perform: "dcica.draft.perform",
} as const;
