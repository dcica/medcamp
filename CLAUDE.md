# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

dcica platform — a non-profit event management and commerce system. The medical camp (300–500 patients, half-day) is the first module and primary build target. The platform also covers general events, annual/multi-year membership, onsite merchandise POS, and vendor registration.

**Payment split:** Stripe for online pre-registration and membership. Stripe Tap to Pay or **cash** for day-of walk-ins, event tickets, add-ons, and merchandise. Zelle or check for vendors and sponsors. Cash is recorded manually by staff (amount tendered, change due shown on screen) and tracked separately in reconciliation.

**Hard constraint: No PHI/HIT stored.** Patient records are camp-scoped (name, phone, paid services only) and purged after each event. No diagnoses, lab results, clinical notes, or insurance data — ever.

## Planned Stack

- **Framework:** Next.js (App Router) — single codebase serves web, tablet, and TV display views
- **Database:** PostgreSQL via Supabase
- **Payments:** Stripe Payment Element (online checkout) + Stripe Terminal SDK / Tap to Pay on phone (walk-in, on-site). Org is 501(c)(3) — apply for Stripe non-profit rate (2.2% + $0.30).
- **Auth:** Google OAuth via NextAuth.js — committee members use existing Google Workspace accounts
- **QR / Badge printing:** `qrcode` npm library + browser print CSS (label printer compatible)
- **Hosting:** Vercel (app) + Supabase (database)

## UI Constraint — Phone-First

**Every volunteer-facing screen must work on a 6" phone.** No pinching, zooming, or horizontal scrolling. Tablets show the same interface larger — they are not required for any station to function.

- Minimum 48px tap targets on all interactive elements
- Single-column layouts on queue and scan views
- QR scanning via device camera (dedicated scanners at busy stations are an enhancement only)
- Label printing: triggered from any phone → sends to the shared WiFi label printer at registration desk
- Coordinator dashboard: readable on phone, expands on larger screens

## Domain Model

```
Camp
  └── Registration
        ├── camp_id (format: MC-YYYY[S|W]-NNNN)
        ├── name, phone, email, mailing_address
        ├── marketing_consent   ← boolean, with consent_timestamp
        ├── services[]          ← pre-paid at registration
        ├── square_payment_id
        ├── waiver_signed
        └── StationVisit[]
              ├── station
              ├── status        ← queued | in-progress | done
              └── added_services[]  ← doctor add-ons, flagged needs_payment

Station    ← configured per camp (varies by venue)
Supply     ← pre-camp estimates only, keyed to service type
LabStatus  ← per registration: pending | received | mailed (date); no lab results stored
```

## Patient Flow

`Registration → Check-In (QR scan) → Vitals → Doctor Consult → [variable labs/imaging]`

- 80% pre-register online; 20% walk-in (tablet form + Square terminal on-site)
- Doctor can add services mid-visit → patient flagged `needs_payment` → escorted to registration desk → Square payment → routed to new station
- Every patient gets a printed badge: QR code + color-coded service dots + checklist

## Modules (build order)

1. **Registration Portal** — unified form + Square checkout + QR confirmation email + service capacity caps
2. **Check-In & Badge** — QR scan gate + digital waiver + badge print
3. **Station Queue** — per-station tablet view + patient routing + add-on payment alerts
4. **Coordinator Dashboard** — real-time god-view: queue depths, payment status, bottleneck alerts, reconciliation export
5. **Supply Calculator** — pre-camp procurement list generator keyed to registered service counts
6. **Checklist Module** — phase-based operations checklist (pre-camp / day-of / during / post-camp); printable run sheet and signage (walk-in hold sign, station directionals, etc.)
7. **Lab Tracking & Patient Portal** — staff marks lab received/mailed; prints address label batch; patients check status by confirmation code
8. **Venue Config** — switchable layouts: Clinic (7 rooms + 2 tents) vs. Open Space (configurable cabins)

## Access Roles

| Role | Access | Cash |
|---|---|---|
| Coordinator | Full dashboard, all modules, volunteer/till setup | Can assign till |
| Registration desk — till holder | Registration, payment, badge print | Yes |
| Registration desk — no till | Registration, payment (Stripe only), badge print | No |
| Station volunteer | Own station queue (scan in/out) | No |
| Doctor | Station view + add-on service flag | No |
| POS volunteer — till holder | Merchandise POS | Yes |
| Committee / admin | Supply calculator, camp setup, reports | No |

Till holders are assigned by the coordinator before camp. Cash option is hidden from non-till volunteers — their payment screen shows Stripe only.

## Repo Structure

```
docs/    — planning documents and committee materials
src/     — application code (Next.js project root goes here)
```

## Key External Integrations

- **Stripe:** Payment Element for online checkout; Terminal SDK + Tap to Pay on phone for walk-in POS. Payment must succeed before registration is confirmed. Non-profit rate applies (501(c)(3) confirmed) — apply at stripe.com/docs/tax-exempt before go-live. Refunds are staff-initiated only (no self-serve refund flow for patients).
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — browser-safe, used in Payment Element
  - `STRIPE_SECRET_KEY` — server-side only, never exposed to client
  - Test keys stored in `.env` (gitignored). Swap for live keys in Vercel env vars at deploy time.
- **Google Workspace:** OAuth login only — no Google Forms, no Sheets, no Drive sync. Those are the systems being replaced.
- **Email:** Confirmation email with QR code sent post-payment (provider TBD; Resend or SendGrid).
