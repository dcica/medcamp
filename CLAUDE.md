# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

dcica platform — a non-profit event management and commerce system. The medical camp (300–500 patients, half-day) is the first module and primary build target. The platform also covers general events, annual/multi-year membership, onsite merchandise POS, and vendor registration.

## Platform Mandate (foundational — overrides single-org assumptions)

This is an **open-source, multi-tenant SaaS** for any non-profit, not a single-org tool for dcica. dcica is the first tenant and reference deployment. Where any doc hardcodes "dcica," read it as "the tenant organization." Full mandate: `docs/Platform-Mandate.md`.

- **Multi-tenant:** `Organization` is the tenant root; every domain record carries `org_id`. Isolation enforced at the DB via Supabase Postgres **Row-Level Security**, not just app logic. Tenant routing by subdomain/slug. Self-serve org onboarding. No cross-tenant leakage — ever.
- **OAuth-first:** OIDC is the primary login (Google, Microsoft, GitHub), not just Google Workspace; email/password is a fallback. RBAC is **tenant-scoped** — roles are defined within an org; a user may belong to multiple tenants.
- **Payments — Stripe Connect:** each tenant connects its own Stripe account; funds settle directly to the org. The platform never holds or remits tenant funds. (Supersedes the single-key setup described below.)
- **Open source — AGPL-3.0:** self-hostable; modifications run as a network service must be published. Ships `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates. No secrets in the repo — env-driven, only `.env.example` committed.
- **Open-core:** core is free + open source; hosted version free/at-cost for verified 501(c)(3)s. Any paid tier never gates the core camp-to-discharge workflow.
- **Self-hostable, pluggable providers:** near-one-command deploy, env-configured. Auth (OIDC), email (Resend/SendGrid/SMTP), payments (Stripe Connect), DB (Postgres) are swappable. **Configuration over code** — branding, modules, service menus, caps, tiers, layouts are per-tenant settings; tenants customize without forking.
- **Privacy is a platform guarantee:** the No PHI/HIT rule applies per-tenant for every org, not just dcica.

**Payment split:** Stripe for online pre-registration and membership. Stripe Tap to Pay or **cash** for day-of walk-ins, event tickets, add-ons, and merchandise. Zelle or check for vendors and sponsors. Cash is recorded manually by staff (amount tendered, change due shown on screen) and tracked separately in reconciliation.

**Hard constraint: No PHI/HIT stored.** Patient records are camp-scoped (name, phone, paid services only) and purged after each event. No diagnoses, lab results, clinical notes, or insurance data — ever.

## Planned Stack

- **Framework:** Next.js (App Router) — single codebase serves web, tablet, and TV display views
- **Database:** PostgreSQL via Supabase — multi-tenant with Row-Level Security keyed to `org_id`
- **Payments:** Stripe **Connect** — each tenant org connects its own account; Payment Element (online checkout) + Terminal SDK / Tap to Pay on phone (walk-in, on-site) run against the connected account. Tenants apply for their own 501(c)(3) non-profit rate.
- **Auth:** OIDC via NextAuth.js — Google / Microsoft / GitHub; tenant-scoped roles. (dcica committee members use existing Google Workspace accounts.)
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
  └── Order                     ← one per checkout (1 registrant, 1+ attendees)
        ├── registrant          ← name, email, phone (contact only, may not be attending)
        ├── marketing_consent   ← boolean, with consent_timestamp
        ├── stripe_payment_id
        ├── cash_amount         ← if paid by cash
        └── Attendee[]          ← one per person actually attending
              ├── camp_id (format: MC-YYYY[S|W]-NNNN)
              ├── name, mailing_address
              ├── services[]    ← pre-paid
              ├── waiver_signed
              └── StationVisit[]
                    ├── station
                    ├── status  ← queued | in-progress | done
                    └── added_services[]  ← doctor add-ons, flagged needs_payment

Station    ← configured per camp (varies by venue)
Supply     ← pre-camp estimates only, keyed to service type
LabStatus  ← per registration: pending | received | mailed (date); no lab results stored
```

## Patient Flow

`Registration → Check-In (QR scan) → Vitals → Doctor Consult → [variable labs/imaging]`

- 80% pre-register online; 20% walk-in (tablet form + Stripe Tap to Pay on-site)
- Doctor can add services mid-visit → patient flagged `needs_payment` → escorted to registration desk → Stripe payment → routed to new station
- Every patient gets a printed badge: QR code + color-coded service dots + checklist

## Modules (build order)

1. **Registration Portal** — unified form + Stripe checkout + QR confirmation email + service capacity caps
2. **Check-In & Badge** — QR scan gate + digital waiver + badge print
3. **Station Queue** — per-station tablet view + patient routing + add-on payment alerts
4. **Coordinator Dashboard** — real-time god-view: queue depths, payment status, bottleneck alerts, reconciliation export
5. **Supply Calculator** — pre-camp procurement list generator keyed to registered service counts
6. **Checklist Module** — phase-based operations checklist (pre-camp / day-of / during / post-camp); printable run sheet and signage (walk-in hold sign, station directionals, etc.)
7. **Lab Tracking & Patient Portal** — staff marks lab received/mailed; prints address label batch; patients check status by confirmation code
8. **Venue Config** — switchable layouts: Clinic (7 rooms + 2 tents) vs. Open Space (configurable cabins)
9. **Volunteer Module** — platform-level, reusable across events: recruitment/outreach, per-event role + age-group config with capacity caps, signup form, 24–48h confirmation reminder, day-of QR sign in/out with hours tracking, thank-you + certificates. Volunteer profiles persist across events (NOT camp-scoped, NOT PHI). See `docs/Volunteer-Module.md`.

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
| Volunteer Coordinator | Volunteer module: role/age config, outreach, reminders, roster, certificates | No |

Till holders are assigned by the coordinator before camp. Cash option is hidden from non-till volunteers — their payment screen shows Stripe only.

## Repo Structure

```
docs/    — planning documents and committee materials
src/     — application code (Next.js project root goes here)
```

## Key External Integrations

- **Stripe:** Payment Element for online checkout; Terminal SDK + Tap to Pay on phone for walk-in POS. Payment must succeed before registration is confirmed. **Budget standard rates (2.9% + $0.30 online).** The 501(c)(3) non-profit rate is *not* available: Stripe requires >80% tax-deductible donation volume and excludes tickets, memberships, and registration fees — dcica is <10% donations. Investigated and closed 2026-08-20; see `docs/Payment-Gateway.md`. Do not reopen. Refunds are staff-initiated only (no self-serve refund flow for patients).
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — browser-safe, used in Payment Element
  - `STRIPE_SECRET_KEY` — server-side only, never exposed to client
  - Test keys stored in `.env` (gitignored). Swap for live keys in Vercel env vars at deploy time.
- **Google Workspace:** OAuth login only — no Google Forms, no Sheets, no Drive sync. Those are the systems being replaced.
- **Google Address Validation (optional):** standardizes mailing addresses for lab labels. Off unless `GOOGLE_MAPS_API_KEY` is set; called server-side once per address on field blur (never per-keystroke, never from the browser). Free under 5,000 calls/mo (~500/camp). Sends one address line to Google at submit time — disclosed in the Privacy Policy.
- **Email:** Confirmation email with QR code sent post-payment (provider TBD; Resend or SendGrid).

## Engineering guardrails

Each of these was written after something broke. They are not style preferences.

### Migrations

- **Author with `prisma migrate diff`; apply with `npm run db:migrate:deploy`** — the repo
  wrapper, never bare `prisma migrate deploy`. The wrapper refuses a remote `DATABASE_URL`
  or `DIRECT_URL` that names no schema, or where the two name different ones (localhost is
  exempt). A schema-less URL silently migrates into `public`, which is how the project
  once accumulated four full copies of itself in one Supabase instance.
- **Never `migrate dev`, `migrate reset`, or `db push`.**
- **Additive-first ordering.** A migration must be safe to apply *before* the deploy that
  reads it: Prisma selects every declared column, so code deployed ahead of its migration
  faults with `P2022`. Constraint *tightening* is the reverse — it must land *after* the
  deploy that stops writing the old shape. This rule exists because of the `/register`
  outage on 2026-08-21.
- **Read every generated migration before committing it** and strip anything you did not
  intend. `migrate diff` diffs the whole schema, so it will happily attach an unrelated
  `DROP COLUMN` to the change you actually meant to make.
- **Migration folders can apply out of lexicographic order.** `migrate deploy` applies any
  unrecorded migration regardless of sort position. That is fine and expected when
  branches are authored in parallel — do not "fix" it by renaming folders.
- **Every FK child column gets a covering index.** Policy established by PR #6, which
  fixed 13 of them. An unindexed FK makes the parent delete scan the child table, and it
  is worst on `ON DELETE SET NULL` edges. Enforced by `npm run verify:schema`, which
  checks index *prefix* coverage across the whole schema — a B-tree on `(a, b)` cannot
  serve a lookup on `b`, so a set test would pass violations.

### Never write raw SQL against a named schema

`$executeRaw` / `$queryRaw` with an unqualified table name resolves through the session's
`search_path`, and Supabase's transaction pooler does **not** reliably apply the connection
string's `?schema=` to every pooled backend — measured on the deployed test DB, 5 of 24
pooled sessions had no `test` in their `search_path`. A raw `UPDATE service_caps` then hit
`public.service_caps`, matched nothing, and rolled back the confirmation, so a **paid order
silently reverted to PENDING with the charge captured** (~1 in 5 confirmations). `prod` is a
named schema too, so the same coin flip applied to real money.

Prisma *model* operations always emit the schema explicitly (`UPDATE "test"."service_caps"`)
and are safe. The forbidding comment at `src/server/payments.ts:242-260` stays.

### Verification

- `npx tsc --noEmit` after every task, then `npm run verify`. Baseline as of 2026-08-23:
  **9 suites, 889 assertions, all green** — schema 54, pricing 39, validation 62,
  storage 31, branding 310, performance 125, gate 101, readiness 91, checkout 76.
  (`pricing` and `validation` print `PASS`; the rest print `ok` — count both when
  reporting totals.)
- **Never make the chain green by weakening a check.** Report before/after assertion counts.
- New checks must be **mutation-tested**: name the one-line source edit that makes the check
  fail, and make it once to prove it does. A check that cannot fail is worse than none.
- There is deliberately no test framework yet; coverage is hand-rolled `tsx` scripts under
  `scripts/`. Several connect to a live database and self-clean.
- Seed order is load-bearing: `db:seed` → `db:seed:events` → `db:seed:test`.

### Branding and theming — settled, with one deliberate carve-out

Tenant theming is complete and reviewed: `src/lib/branding.ts`, the root layout's style
emission, `SiteHeader`/`SiteFooter`, `admin/settings/*`, `scripts/verify-branding.ts`.
Themeable surface is exactly six colour tokens (`brand`, `accent`, `accent2` and their `-fg`
pairs), a wordmark, and two asset URLs — validated as strict 6-digit hex on write **and
again at render**, immediately before interpolation into the `<html>` style attribute,
because `Organization.settings` is arbitrary JSON and an unvalidated value there is
attacker-controlled CSS.

**`STATUS_STYLE`, dashboard alert colours and per-service/per-station `colorHex` are
deliberately outside the theme, and `scripts/verify-branding.ts` §8 enforces it.** Status
colour is *meaning*, not identity: green=OPEN / amber=CLOSED / red=problem is a convention a
volunteer reads at a door, in gym lighting, under time pressure. A brand-red "paid" chip
would read as a safety signal. The theme validator also only checks each colour against its
own foreground — nothing checks that six tenant colours stay mutually distinguishable, which
is precisely the property a status palette needs. Don't "fix" this without replacing that
validator first.
