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
