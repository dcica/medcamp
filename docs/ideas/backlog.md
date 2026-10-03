# Idea Backlog

> Quick-capture parking lot. Use `/dictate` to add, `/dictate list` to review, `/dictate pick up` to start work.

---

## D001 — Add Google address match on all address entry fields
- **Type:** Feature
- **Status:** DONE
- **Captured:** 2026-06-19
- **Completed:** 2026-06-19
- **Details:**
  Add google address match on all address entry fields.
  (Implemented with Google **Address Validation API** — single server-side call on blur, suggest-&-confirm UX, never blocks. Autocomplete was rejected for privacy/cost.)
- **Related:** Reusable `src/app/_components/AddressInput.tsx` (+ `address-action.ts`, `src/lib/addressValidation.ts`) now wired into attendee `mailingAddress` in `RegisterForm.tsx`. Future volunteer / vendor / org-onboarding address fields should adopt `<AddressInput>`. Key: `GOOGLE_MAPS_API_KEY` (optional; off ⇒ plain input). Scope noted in CLAUDE.md + Privacy Policy.

---

## D002 — Discuss Vercel vs other platforms to deploy
- **Type:** Architecture
- **Status:** PARKED
- **Captured:** 2026-06-19
- **Details:**
  Discuss vercel vs other platform to deploy. Need to keep it in free zone.
  (Compare hosting options — cost is the constraint, must stay in free tier.)
- **Related:** Planned stack currently names Vercel (app) + Supabase (DB). Non-profit / open-source cost sensitivity; ties to Approach C self-host packaging (deferred).

---

## D003 — No-show won't be refunded; money taken as a donation
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-06-19
- **Details:**
  add a noshow wont't be refunded. money will be taken as a donation
  (No-show registrations are not refunded — the paid amount is retained and recorded as a donation.)
- **Related:** Extends the refund policy now in `/register` inline help (`src/app/register/page.tsx`) and the "refunds only if rescheduled" rule + CLAUDE.md's staff-initiated-refunds stance. Likely a reconciliation / donation-tracking concern for the coordinator dashboard.

---

## D004 — Tap to Pay at the gate (card, not just cash)
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-10-03
- **Details:**
  Take card payment at the door. Today the gate is **cash or nothing**: "till vs
  no till" means *may record cash*, not *may take a card*. There is no Stripe
  control anywhere on `/scan`, and no Terminal / Tap-to-Pay code in `src/`.
  A walk-up who has no cash currently has to buy on their own phone through
  `/register` (hosted Stripe Checkout) and then be scanned like any other guest.
- **Why it is not already built:** this was a decision, not an oversight.
  Architecture decision 2026-06-19 locked **hosted Stripe Checkout, no native
  Tap-to-Pay**; the reasoning is recorded at `src/server/payments.ts`
  ("decision #7: hosted Checkout, no native build"). Revisiting it means
  revisiting that.
- **What it actually costs:** Stripe **Terminal SDK**, which is not a web API —
  Tap to Pay on iPhone/Android needs a native app or a WebView shell, plus
  reader/location provisioning in the Stripe account, plus a connection-token
  endpoint. It also interacts with Stripe **Connect** (Platform Mandate: each
  tenant connects its own account), so the reader has to be provisioned against
  the *connected* account, not the platform's.
- **Related:** `CLAUDE.md` still advertises "Terminal SDK + Tap to Pay on phone
  for walk-in POS" in the stack section — that line is **stale** and should be
  corrected or marked aspirational whichever way this goes.
  Gate cash path: `sellAndAdmit` / `confirmGateCash` in `src/server/gate.ts`,
  UI in `src/app/scan/GateMode.tsx` (WalkUpForm).
  Note the adjacent gap: there is **no tender/change capture** either —
  `Payment.cashTenderedCents` exists and `changeDueCents()` in
  `src/lib/money.ts` has zero call sites.
