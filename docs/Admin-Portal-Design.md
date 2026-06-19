---
title: Admin Portal Design
nav_order: 10
---

# Admin Portal Design
{: .fs-9 }

The internal setup surface — how coordinators and committee/admins configure a camp without touching code or the database. Consolidates the setup workflows scattered across the System Overview, the role table, and the static mockups into one design.
{: .fs-6 .fw-300 }

---

## Status

**Design doc — not yet built.** The data model already supports everything here (config-over-code rows), but today those rows exist only via `prisma/seed.ts`. Locked engineering decision #10 commits to building the config admin UIs now (with a claw-back lever if the build gets tight). This doc is the spec for that build.

## Principles

1. **Config-over-code.** Branding, service menu, capacity caps, stations, layouts, checklists are per-tenant **database rows**, edited here — never code changes or redeploys. Adding a service or changing a cap is an admin action.
2. **Approach C (single tenant now).** One active organization (`DEFAULT_ORG_SLUG`). Every screen writes rows already scoped by `orgId`; the admin portal is **not** tenant onboarding (that's deferred until a real second org). No org-creation UI here.
3. **RBAC-gated.** The whole portal lives behind `requireRole(...)`. Coordinator is superuser; Committee/admin gets the setup + reports subset. Server actions re-check the role — middleware is only the optimistic gate.
4. **No PHI.** Nothing here stores clinical data. Service menu defines *what's offered and priced*, never results.

## Access

| Area | Coordinator | Committee/Admin | Notes |
|---|---|---|---|
| Camp setup, lifecycle | ✓ | ✓ | Open/close/purge are coordinator-confirmed |
| Service menu & caps | ✓ | ✓ | |
| Stations & routing | ✓ | ✓ | |
| Venue configuration | ✓ | ✓ | |
| Members, roles & till | ✓ | — | Till/role assignment is coordinator-only |
| Supplies / procurement | ✓ | ✓ | |
| Checklist templates | ✓ | ✓ | |
| Branding / org settings | ✓ | — | |

Route group: **`/admin/*`** (add to middleware's protected matcher). Each page calls `requireRole("COORDINATOR", "COMMITTEE_ADMIN")` except member/till management which is `requireRole("COORDINATOR")`.

## Information architecture

```
/admin
 ├── (dashboard)        camp picker + setup health checklist
 ├── /camps             list + create; per-camp:
 │     ├── /[id]            details, dates, code, lifecycle
 │     ├── /[id]/services   service menu + capacity caps for this camp
 │     ├── /[id]/stations   stations + routing order
 │     ├── /[id]/venue      Clinic vs Open Space layout
 │     ├── /[id]/supplies   procurement calculator
 │     └── /[id]/checklist  checklist template (phases/items)
 ├── /members           people, roles, till assignment
 └── /settings          branding, org-wide defaults
```

---

## Screens

### 1. Camp setup & lifecycle
Maps to **`Event`**. Create/edit name, `code` (e.g. `MC-2026W`), `startsAt`/`endsAt`, `type`.

The lifecycle is the **purge state machine** (decision #4) and must be explicit, not a free dropdown:

```
DRAFT → OPEN → ACTIVE → CLOSED → PURGEABLE → PURGED
```

- **Open registration** (`DRAFT/→OPEN`): makes the public `/register` portal live for this camp.
- **Start day-of** (`OPEN→ACTIVE`).
- **Close** (`→CLOSED`): stamps `closedAt`; check-in stops.
- **Purge** (`→PURGED`): coordinator-confirmed, destructive — strips attendee PII, keeps anon counts + consented contacts. Show what survives vs. what's destroyed before confirming.

Guardrails: can't open two camps into the same public slot ambiguously (v1 = one OPEN camp); closing warns if labs are still open (purge is held until last-lab-mailed).

### 2. Service menu & capacity caps
Maps to **`ServiceType`** (org-level menu) + **`ServiceCap`** (per-camp capacity).

- Menu editor: name, `key`, `priceCents` (integer cents — dollar input, store cents), `colorHex` (badge dot), `hasLab` (drives lab tracking + purge hold), `active`.
- Per-camp caps: capacity per service; show **`sold` vs `capacity`** live (the atomic counter the payment webhook decrements). Editing capacity is allowed; lowering below `sold` is blocked.
- Deactivating a service hides it from `/register` but preserves history.

### 3. Stations & routing
Maps to **`Station`** (per camp) — `key`, `name`, `sequence`, `active`. Drag to reorder = the default Care Spine route applied to each attendee at confirmation. (Per-attendee deviations are runtime, Module 3.)

### 4. Venue configuration
Maps to **`Event.venueConfig`** (JSON). Pick **Clinic** (7 rooms + 2 tents) vs **Open Space** (configurable cabins) per System Overview; set room/cabin counts and the TV queue-display toggle. This drives station placement labels and signage.

### 5. Members, roles & till  *(coordinator-only)*
Maps to **`Membership`** (`role`, `canHoldTill`). **This closes the biggest current gap** — today memberships only happen via `BOOTSTRAP_ADMIN_EMAILS` / dev-login.

- List members of the org with role + till status.
- Invite by email (creates a pending membership; the person gains access on first OIDC login with that email).
- Assign/cha­nge role (the 8-role enum); toggle `canHoldTill` (cash capability — enforced server-side, decision in IAM review).

### 6. Supplies / procurement (Module 5)
Maps to **`Supply`** (pre-camp estimates). Enter registered counts per service → generates a procurement list (`perUnit × count + buffer`), category-grouped (Medical / Food / Stationery), manual per-item override, printable. **Pre-camp only — not a live inventory system** (System Overview).

### 7. Checklist templates (Module 7)
Phase-based template (`pre_camp / day_of / during / post_camp`) with items (description, category, assigned role, `print_artifact` flag). **Schema gap — see below.**

### 8. Branding & org settings *(coordinator-only)*
Maps to **`Organization.settings`** (JSON): brand color (the `--brand` CSS var), locale default, feature toggles. The config-over-code seam that lets a future tenant rebrand without forking.

---

## Schema reconciliation — resolved decisions

The System Overview and Design System implied config the original schema didn't hold. Resolved 2026-06-19; implemented as one additive migration:

| Gap | Decision | Implementation |
|---|---|---|
| **Checklist templates** (Module 7) | **Add** | `ChecklistItem` per event (definition + run state collapsed — description, `phase`, `category`, `assignedRole?`, `printArtifact`, `sequence`, `status`, `completedBy?`, `completedAt?`). Cross-event template reuse deferred. |
| **Per-station color** | **Auto-assign** | `Station.colorHex` (nullable); `autoStationColor(key, sequence)` fills it from the Care Spine palette on create — admins never pick a color. |
| **Override-auth role** | **Add flag** | `Membership.canOverrideWaiver` boolean (mirrors `canHoldTill`); not a new role. |
| **Walk-in open time** | **Add column** | `Event.walkInOpensAt` (nullable DateTime); coordinator toggle on day-of. |
| **Member invite** | **Invite table** | `Invite(orgId, email, role, canHoldTill, canOverrideWaiver, invitedById?, acceptedAt?)`; consumed on first OIDC login (auth `signIn` event) to create the membership. |

## Build phasing (within decision #10)

1. **Members, roles & till** + **Camp setup/lifecycle** — highest value; unblocks running a real camp without seed/dev tools.
2. **Service menu & caps** + **Stations & routing** — completes "stand up a new camp from scratch."
3. **Venue config** + **Branding** — polish; both are JSON-blob editors.
4. **Supplies** (Module 5) and **Checklist** (Module 7) — the latter needs new tables; can lag the day-of critical path.

## Out of scope

- **Tenant onboarding / org creation** — deferred (Approach C; needs subdomain routing, RLS, Stripe Connect).
- **Live merchandise inventory / POS stock** — `Supply` is pre-camp estimates only; merchandise POS is a Platform-Extensions concern, not modeled here.
- **Self-serve billing tiers** — open-core, deferred.

---

*Spec for the `/admin` build. Reconcile the schema gaps above as part of phase 1–2. See `docs/MedCamp-System-Overview.md` for the operational context and `CLAUDE.md` for the canonical domain model.*
