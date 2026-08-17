# Rhythm of Navratri — ticketing, service kinds, and online member verification

**Date:** 2026-08-16
**Event deadline:** 2026-10-10 (8 weeks)
**Status:** approved design, not yet implemented

## Context

The next event is a single night on **October 10, 2026 at McKamy Middle School,
Flower Mound TX**. The evening runs in two acts: the *Rhythm of Navratri* dance
competition at 5:00 PM (desk opens 4:30), then the floor opens for public
dandiya dancing. A flyer with a registration QR code is already public on
dcica.org, so a working checkout is not optional.

Three things are sold:

| Item | Price | Kind |
|---|---|---|
| Dance competition entry | $30 per group | Fee — no floor access, no ticket |
| Floor admission | $15 online / $20 at the door | Admission — scannable ticket |
| Dandiya sticks | $5 per pair | Merch — handed over at the gate |

A current family membership comps **4 floor admissions**. It does not touch the
competition fee.

Most of the machinery already exists: quantity-mode checkout, will-call merch
hand-over, the gate scanner, membership plans, the ledger. This design covers
what is missing and what is wrong.

## Decisions taken

**One Event row, three services** — not two events. RoN and the open floor are
one night, one door, one headcount. Two ACTIVE `GENERAL` events would break
`getActiveGeneralEvent()`, which resolves exactly one, and would force a family
buying competition entry plus tickets through two checkouts with two QR codes.
Reconciliation already breaks down by service, so per-act reporting survives.

**Member verification is approach A** — a DB-backed OTP challenge plus a
short-lived server-side session, re-validated at order creation. Not a stateless
signed token (unrevocable, can't be made single-use, and two tabs replay it).
Not NextAuth magic-link accounts — that is the right destination, so this design
adds the seam for it, but merging `User` and `Member` is a modeling decision, not
a login feature, and it does not fit before October 10.

**The comp allowance is once per member per event**, claimed when the order is
priced and released if the order dies.

## Data model

### Service kinds

`ServiceType` currently has one boolean, `fulfillable`, and the code infers
everything else from it: a non-fulfillable service is admission and mints a
scannable ticket. That leaves no room for a fee. The competition entry would
either mint a phantom ticket per group or tell a volunteer to hand over a
physical object.

```prisma
model ServiceType {
  /// Issues a scannable admission ticket and counts toward headcount.
  /// Three kinds, from two flags: admission (admits), merch (fulfillable),
  /// fee (neither) — e.g. a competition entry that grants no floor access.
  admits Boolean @default(true)
}
```

Migration backfills `admits = NOT fulfillable`, so existing events behave
identically.

### Channel pricing

Both the online form and the gate read `ServiceCap.priceCents`. Nothing
distinguishes the $15 online price from the $20 door price.

```prisma
model ServiceCap {
  /// Price charged at the door. Null = same as the online price.
  onsitePriceCents Int?
}
```

`sellAtGate()` uses `onsitePriceCents ?? priceCents`. Online registration keeps
using `priceCents`. A will-call order bought online at $15 and settled in cash at
the door stays $15 — that path confirms existing lines and never re-prices.

### Member verification

```prisma
model MemberVerification {
  id        String   @id @default(cuid())
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  email     String
  codeHash  String   // never store the code itself
  expiresAt DateTime
  attempts  Int      @default(0)
  consumedAt DateTime?
  createdAt DateTime @default(now())

  @@index([orgId, email])
}
```

Org-scoped deliberately. NextAuth's `VerificationToken` has a global
`identifier` and reusing it would make membership existence readable across
tenants once a second org exists.

### Comp claims and attribution

```prisma
model MemberComp {
  id        String   @id @default(cuid())
  orgId     String
  memberId  String
  eventId   String
  orderId   String?
  quantity  Int
  claimedAt DateTime @default(now())

  @@unique([memberId, eventId])   // hard once-per-event guarantee
  @@index([orgId, eventId])
}

model Order {
  /// Set when a verified member checked out. Also lets the door see who
  /// already claimed their comp online.
  memberId String?
  /// The registrant said they were a member but we could not match them.
  /// Desk resolves on arrival; never a hard refusal.
  memberClaimUnverified Boolean @default(false)
}

model Member {
  /// Seam for the eventual member portal. Non-unique: one User may hold
  /// memberships in several orgs.
  userId String?
  @@index([orgId, userId])
}
```

Release is a row delete, not a soft flag — a partial unique index
(`WHERE releasedAt IS NULL`) can't be expressed in Prisma and would need raw SQL.
History lives in `Order.memberId`.

## The OTP flow

1. The form asks "Are you a dcica family member? Members get 4 free admissions."
2. On an email submit, look up `Member` by `(orgId, email)`.
   **Only send a code if a member exists**, but return an identical response
   either way. This blocks enumeration and, just as importantly, protects SES
   reputation — codes are never sprayed at addresses outside a roster we control.
3. Code entry verifies against `codeHash`, then sets an httpOnly cookie holding
   `{orgId, memberId}`.
4. `createRegistration` re-reads the cookie **server-side** and re-resolves the
   member against the request's org. The browser never asserts membership; the
   cookie is a pointer, not a claim.

### Parameters

| Setting | Value | Reasoning |
|---|---|---|
| Code | 6 digits, numeric | Typed on a phone by people of every age. 10⁶ space with 5 attempts and per-email throttling is ample. |
| Expiry | 30 minutes | 10 was the security recommendation; 30 wins because the realistic failure is a code sitting in Promotions while dinner happens. |
| Max attempts | 5, then burn the code | |
| Resend floor | 60 seconds | |
| Per email | 3 codes/hour | |
| Per IP | 10 sends, 30 verifies/hour | |
| Circuit breaker | 200 sends/hour/event | Catches a runaway loop before SES does. |

**Rate limiting uses a Postgres token-bucket row** updated via a single
conditional `UPDATE`, which is atomic and already in the stack. At roster scale
(hundreds of households) Redis would add a dependency and a failure mode for
nothing. A Vercel WAF rule on the OTP routes provides the coarse per-IP layer.

### Claim timing

The `MemberComp` row is created when the order is **priced**, not at payment
confirmation. Claiming at confirmation would let two concurrent checkouts both
price at $0 and fail the second one *after* the member had already paid.

The claim TTL is bound to the Stripe session: `createCheckoutForOrder` currently
sets no `expires_at`, so Stripe holds a session for 24 hours. Set it to 30
minutes and make the claim TTL identical.

The claim is re-validated inside the `PENDING → CONFIRMED` transaction, but
**a lost claim must never fail a paid order**. Honor the comp and flag it for the
coordinator. Failing costs a real payment; honoring costs $60.

### When the email is not found

Never a wall. Show a lane:

> "We don't see a membership under that email — it may be under a different one,
> or your spouse's. You can try another email, or continue and we'll sort it out
> at the desk."

The order is flagged `memberClaimUnverified` and the desk resolves it on arrival.
An unverified claim degrades to today's door behavior rather than to a refusal.
Expect real friction here: a spreadsheet-imported roster keyed on email will have
a meaningful share of stale, shared, or missing addresses.

### Expired membership

Show the lapse date and the renewal plans inline. Renewing in the same checkout
comps the 4 admissions against the new term. Declining charges full admission.
This reuses the membership-purchase path that already exists in checkout.

## Related corrections in scope

**Headcount and entitlements.** `createQuantityOrder` mints a fallback attendee
when an order contains no admission units, so a competition-only purchase still
gets a scannable code — correct, since the group needs to prove they paid. But
that code is a receipt, not floor access. `getEventHeadcount()` counts every
attendee with `checkedInAt`, so scanning that receipt would inflate the floor
count. Headcount must count admission units; the gate must show what the guest is
entitled to ("Competition entry — no floor access").

**The door comp is staying.** It is the fallback for every failure above.
`compAdmit()` needs two fixes: it discards its `userId` (`void userId`) so there
is no audit trail of who comped whom, and it bypasses `confirmOrderPaid`
entirely — no ledger row, no capacity decrement — making comps invisible to both
reconciliation and the headcount. When a member has already claimed online, the
door must say so: *"Membership already used for this event (4 admissions).
Charge $20 each, or ask a coordinator to override."* Volunteers should never be
the ones saying no.

**Past events must stop showing.** `/events` filters on `status: OPEN | ACTIVE`
with no date condition, so a finished event lingers until someone flips its
status by hand. Add `endsAt: { gte: now }` — `endsAt`, not `startsAt`, so an
event in progress stays visible. `/register` has the same gap and will happily
serve a checkout for a past event.

**Seed corrections.** The `test` seed's "Dandia Night 2026" fixture is ACTIVE on
October 10 and would out-rank the real event at the gate. Take it off ACTIVE.
The real event needs its services, prices, caps, location, and
`collectsAttendeeDetails: false` configured **in `seed-events.ts`**, not through
the admin UI — CI reseeds on every push and `seed-events.ts` deletes and
recreates all events, so admin-entered config on test would be silently wiped.

## Out of scope

- Competition rosters, categories, and judging. The $30 entry is a line item;
  the group roster is run off-system.
- Reconciling online and door comps against a shared allowance. `Order.memberId`
  is the seam that closes it later without a rewrite.
- Comps as matched CREDIT/DEBIT ledger pairs so a treasurer can see revenue
  foregone. Worth doing; not before October 10.
- A member portal, self-serve renewal, and merging `Member` with `User`.

## Sequencing

Ordered so the event still ships if the tail is cut:

1. ~~Quantity-aware Stripe totals, comp cap, membership-on-payment~~ **(done 2026-08-16, `npm run verify:pricing`)**
2. ~~`ServiceType.admits` + `ServiceCap.onsitePriceCents` + admin fields~~
   **(done 2026-08-16, migration `20260816120000_service_kind_and_onsite_price`)**
3. Seed the real Oct 10 event; de-conflict the test fixture
4. Past-event filtering on `/events` and `/register`
5. Headcount/entitlement split; `compAdmit` audit trail
6. Member OTP verification

## Risk

Two of four review lenses argued against building online member verification for
this event at all — estimating under 15% of member households would use it to
save $15, against a roster whose email quality will produce "we don't see a
membership under that email" for genuine, paying members. The owner elected to
build it after hearing that. It is sequenced last so the event ships without it.

The largest night-of risk is not code: the gate app makes a network round trip
for every scan, comp, and cash sale, and middle-school wifi with 300 phones in a
gym is a real threat. There is no offline mode. Print a paper fallback roster and
decide in advance who owns the "network is down, take cash and write names" call.

## Verification

There is no test framework — a deliberate call given the deadline; standing up
Vitest now costs days that the defect list needs. `npm run verify:pricing`
(`scripts/verify-pricing.ts`) asserts the money path against a scratch event and
cleans up after itself. Extend it per step above.

Before the event: a Stripe test-mode pass on the deployed test env exercising a
real checkout and webhook (the pricing script asserts the checkout invariant but
does not call the Stripe SDK), and a gate rehearsal on real phones.
