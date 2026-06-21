---
title: QA — Event Gate Flow
nav_order: 12
---

# QA — Event Gate Flow (`/gate`)

Repeatable manual test for the event gate — the scan-to-admit station for
general / ticketed events (e.g. a dandiya dance night). The gate shares the
scan→resolve primitive with medcamp check-in, but its actions are **admission +
will-call merch pickup + on-the-spot POS**, with continuous scanning.

- **Route:** `/gate` · **UI:** `src/app/gate/` · **Server:** `src/server/gate.ts`
- **Last run:** 2026-06-21, local (`:3100`) — **PASS, no functional bugs.**

---

## Prerequisites

1. **Seed the test fixtures** (creates the gate event + tickets + roles):
   ```bash
   npm run db:seed:test
   ```
2. **Test login enabled** (`.env`): `TEST_LOGIN_ENABLED=true`, shared
   `TEST_LOGIN_PASSWORD` (dev default `camp-test`). On a deployed env, the
   `test` environment has it on; `prod` never does.
3. **Sign in with a till-holder role** at `/test-login` — username `regdesk`
   (Registration desk — till holder) or `coordinator`. Cash steps need a till
   (see access matrix); admit/comp/pickup do not.

> The gate opens for the single **ACTIVE** event of type **GENERAL**. The seed
> marks `GB-2026W "Dandia Night 2026"` active.

---

## Test fixtures (from `prisma/seed-test.ts`)

Gate event **GB-2026W — "Dandia Night 2026"** (ACTIVE), starting headcount **1**
(ticket `0003` pre-admitted).

| Ticket ID | Guest | State | Exercises |
|---|---|---|---|
| `GB-2026W-0001` | Asha Mehta | Paid | Admit a paid guest |
| `GB-2026W-0002` | Ravi Kapoor | Paid + pre-bought merch | Admit + will-call pickup |
| `GB-2026W-0003` | — | Already admitted | "Already admitted" display |
| `GB-2026W-0004` | Imran Vora | Unpaid (will-call) | Pay-at-gate (cash) then admit |

**Catalogue:** Dandia Entry · $25.00 (admission) · Dandiya Sticks · $15.00 and
Event T-Shirt · $20.00 (merch). Plus a **member comp** (covers up to 4) and a
**walk-up sale** path that need no ticket.

---

## Access matrix

| Action | Roles | Till required? |
|---|---|---|
| Resolve / Admit / Comp / Hand over pre-bought | `REGISTRATION_TILL`, `REGISTRATION_NO_TILL`, `STATION_VOLUNTEER`, `POS_TILL` (and `COORDINATOR`) | No |
| Pay-at-gate · Walk-up sale · Buy-more (any **cash**) | Same roles **with** till capability | **Yes** (`requireTill`) |

Cash buttons are server-guarded — a no-till volunteer who tries a cash action
gets a `/403`, not a silent success.

---

## Test cases

Use the **"Or enter ticket ID"** manual field (camera not required). After each
admit, confirm the **Admitted** headcount increments and a green flash appears.

| # | Steps | Expected |
|---|---|---|
| 1 | Hit `/gate` **signed out** | Redirects to `/login` |
| 2 | Sign in as `regdesk`, open `/gate` | Shows "Dandia Night 2026", headcount **1**, scanner, manual entry, comp, walk-up |
| 3 | Resolve `GB-2026W-0001` | Guest "Asha Mehta", **"Paid ✓ — Admit & wristband"**, Buy-more catalogue |
| 4 | Click Admit | Headcount **+1**, flash "Asha Mehta admitted — give wristband" |
| 5 | Resolve `GB-2026W-0004` | "Unpaid — owes $25.00", **"Take cash $25.00 & admit"** |
| 6 | Click Take cash & admit | Headcount **+1**, flash "…paid & admitted" |
| 7 | Re-scan `GB-2026W-0001` (idempotency) | **"Already admitted ✓ (time)"**, no headcount change |
| 8 | Resolve `GB-2026W-0002` | Paid + **"Pre-bought — hand over / Dandiya Sticks"** section |
| 9 | Tick Dandiya Sticks → Hand over selected | Flash "Handed over ✓"; re-scan shows it "handed over" |
| 10 | Admit `0002` | Headcount **+1** |
| 11 | Resolve `GB-2026W-0003` | "Already admitted ✓" (pre-admitted by seed) |
| 12 | Member comp: set count, Comp & admit | Headcount **+count**, flash "Comped N — give wristband" |
| 13 | Walk-up: No-ticket → pick Dandia Entry → Take cash & admit | Headcount **+1**, flash "Walk-up admitted" |
| 14 | (Negative) Sign in as `regdesk-notill` or `volunteer`, try a cash action | `/403` — cash blocked for non-till |

**Server guarantees to confirm:** admission requires a CONFIRMED (paid) order
unless paid at the gate; a re-scan never double-counts (wristband owns
re-entry); prices come from the server catalogue, never the client.

---

## Reset

QA mutates data (admits, comps, walk-ups). Reset the fixtures with:

```bash
npm run db:seed:test     # local
```

On the deployed `test` env, the `DB migrate + seed` workflow re-runs
`db:seed:test` on every push to the `test` branch.

---

## Notes

- QA was performed via the headless browse tool against `:3100`. It occasionally
  drops the page to `about:blank` after a server-action round-trip (no console
  error) — a harness flake, not a gate defect; retry in a fresh session.
- Cosmetic: the seed spells the gate event **"Dandia Night"** while the public
  events lineup uses **"Dandiya"** — harmless, just inconsistent test spelling.
