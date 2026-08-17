repo: dcica/medcamp
branch: main

## Last sync
date: 2026-08-16
read-only: design review against existing code (no files imported)

### Updated in this project
- Confirmed `PaymentMethod` already carries `ZELLE` / `CHECK` — designed Zelle rails fit the schema.
- Found no schema field for a Zelle transaction reference; flagged as required for the booth flow.
- Aligned door-comp design with the existing Payment Override role flag + reason audit trail.
- Recorded that RoN-by-Zelle diverges from `docs/Payment-Gateway.md`'s payment matrix.

## Screen map
| Design screen | Built from / relates to |
|---|---|
| Tickets, Stripe checkout | `src/server/payments.ts`, `docs/Payment-Gateway.md` §1 |
| Cash tendered & change (till-gated) | `Payment.cashTenderedCents` / `cashChangeCents` / `recordedByUserId`; §4 Cash |
| Member comp at door, board hand-off | §5 Payment Override (reason codes, separate role flag) |
| Booth payment · Zelle + transaction code | `PaymentMethod.ZELLE`; `src/app/vendors/page.tsx` (intent capture only today) |
| Awaiting payment match | `PaymentStatus.PENDING` — no webhook exists for Zelle |
| Close-out & reconciliation | `LedgerEntry`, §Reconciliation export columns |
| Volunteer module | `Volunteer`, `VolunteerRole`, `VolunteerSignup`, `docs/Volunteer-Module.md` |
| Membership roster, allowance | `Membership`, `MembershipPlan` |
