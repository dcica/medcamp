---
title: Platform Mandate
nav_order: 2
---

# Platform Mandate — Open-Source, Multi-Tenant SaaS

**Status:** Foundational — applies to every module, current and future

This platform is built as an **open-source, multi-tenant SaaS** that any non-profit can adopt — not as a single-organization tool for dcica. dcica is the first tenant and the reference deployment; it is not the only one. Every design and engineering decision must hold for an arbitrary organization we have never met.

This mandate **overrides** any module spec that assumes a single organization. Where an existing doc hardcodes "dcica," read it as "the tenant organization."

---

## 1. Multi-Tenancy

- **`Organization` is the tenant root.** Every domain record (events, camps, registrations, members, vendors, sponsors, volunteers, products, sales) carries an `org_id`. There is no global data except the tenant registry itself.
- **Isolation is enforced at the database**, not just the application layer. Supabase **Postgres Row-Level Security (RLS)** policies key every table to `org_id`; a query without a tenant context returns nothing.
- **Tenant routing** by subdomain (`tenant.platform.org`) or slug (`/o/tenant`). The resolved tenant sets the RLS context for the request.
- **Self-serve onboarding** — an organization signs up, creates its tenant, and configures itself without our involvement.
- **No cross-tenant leakage, ever** — IDs, QR codes, member lookups, and reports are all tenant-scoped. This is a correctness and trust requirement, not a nicety.

## 2. Auth — OAuth-First

- **OAuth / OIDC is the primary login**, generalized beyond Google Workspace to any provider: Google, Microsoft, GitHub. Email/password is a fallback, not the default.
- **RBAC is tenant-scoped.** The existing roles (Coordinator, Registration desk, Station volunteer, Doctor, POS, Committee/admin, Volunteer Coordinator) are defined *within* an organization. A user may belong to more than one tenant with different roles in each.
- The first user to create a tenant becomes its owner/admin and invites the rest.

## 3. Payments — Stripe Connect

- **Each tenant connects its own Stripe account via Stripe Connect.** Funds settle directly to the organization. The platform **never holds or remits tenant funds** — this avoids money-transmission liability and keeps each non-profit's finances its own.
- Connect onboarding replaces the current single-key setup. The platform's own keys exist only to operate Connect; tenant charges run against the connected account.
- Tenants apply for their own 501(c)(3) Stripe non-profit rate. Cash, Zelle, and check flows remain per-tenant and unchanged.
- The **no-self-serve-refund** rule and staff-initiated refunds stay, now per-tenant.

## 4. Open Source — AGPL-3.0

- Licensed **AGPL-3.0**. Anyone may self-host and modify; anyone running a modified version as a network service must publish their changes. This protects the open-core model while keeping the platform genuinely free.
- The repository ships the contribution infrastructure of a real OSS project: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and issue/PR templates.
- **No secrets in the repo.** All credentials are environment-driven; `.env` is gitignored and only `.env.example` is committed.

## 5. Open-Core / Hosted Model

- The **core platform is free and open source**, fully self-hostable.
- A **hosted version is free (or at-cost) for verified 501(c)(3) organizations**, removing the setup bar for non-profits that can't run their own infrastructure.
- Any future paid tier (premium support, managed add-ons) funds development and never gates the core camp-to-discharge workflow.

## 6. Self-Hostability & Pluggable Providers

- An organization must be able to **stand up its own instance** with a documented, near-one-command deploy (Docker / Vercel + Supabase), configured entirely through environment variables.
- **Providers are swappable** — no hard lock-in:
  - **Auth:** any OIDC provider via NextAuth.js
  - **Email:** Resend / SendGrid / SMTP behind one interface
  - **Payments:** Stripe Connect (pluggable at the gateway boundary)
  - **Storage / DB:** Postgres (Supabase or self-managed)
- **Configuration over code.** Branding (logo, design tokens), enabled modules, service menus, capacity caps, sponsor tiers, and venue layouts are all per-tenant settings — a tenant customizes the platform **without forking it**.

## 7. Privacy — A Platform Guarantee

- The **No PHI / HIT** constraint is now a guarantee the platform makes to *every* tenant, not just a dcica rule. Patient records stay camp-scoped (name, phone, paid services), tenant-isolated, and purged after each event. No diagnoses, lab results, clinical notes, or insurance data — ever, for any tenant.

---

## What This Changes in Existing Docs

| Doc | Reconciliation |
|---|---|
| **System Overview** | "dcica" → the tenant organization; add `org_id` context to the data model |
| **Platform Extensions** | `Organization (dcica)` is the tenant root of a multi-tenant tree, not a singleton |
| **Payment Gateway** | Single Stripe key → Stripe Connect per-tenant onboarding |
| **Design System** | Brand tokens become per-tenant theme values, not fixed constants |
| **Privacy / Terms** | Per-tenant; the platform operator and each tenant org have distinct responsibilities |

These reconciliations are applied incrementally as each module is built; this mandate is the source of truth when a module spec and the multi-tenant model disagree.
