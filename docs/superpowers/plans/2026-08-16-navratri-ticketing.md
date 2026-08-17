# Rhythm of Navratri — Implementation Plan

> On approval, copy this to `docs/superpowers/plans/2026-08-16-navratri-ticketing.md` and commit it alongside the spec.

**Spec:** `docs/superpowers/specs/2026-08-16-navratri-ticketing-and-member-verification-design.md`
**Design:** `docs/design_handoff_dcica_events/` — `DCICA Member Checkout.dc.html` (13 states), `DCICA Events.dc.html` (21 screens), `DCICA Operations.dc.html` (13 screens), `README.md`
**Goal:** Sell and run the October 10 2026 Rhythm of Navratri evening end to end — configurable pricing, member self-verification, an anonymous party pass, and a door that can correct its own mistakes.

## Context

One event, one night, ~8 weeks out, with a public flyer already carrying a registration QR code. The evening opens with a group dance competition and then the floor opens for public dandiya. Three things sell: floor admission, dandiya sticks, and a competition entry that grants no floor access.

Most of the machinery exists. Three money defects were fixed earlier today (quantity-aware Stripe totals, the membership comp cap, and membership-on-payment), and the three-kind service model shipped with migration `20260816120000_service_kind_and_onsite_price`. What remains is: pricing that a coordinator can configure rather than a developer, the member verification flow, the real event seeded, and a door that has an undo button and a cash drawer that counts.

The design handoff arrived after the functional work, so this plan merges them: the `.dc.html` files are the UI contract, this codebase is the functional contract, and where they disagreed the disagreements were resolved with the client (see Decisions).

## Global Constraints

- **Phone-first, 390×844, single column.** No pinch-zoom, no horizontal scroll. 48px minimum tap target; 56px for volunteer primaries.
- **`border-radius: 0` everywhere.** Defining rule of the design system.
- **Colour:** navy `#0c3543`, saffron `#f9a200`, flag-green `#138808`, canvas `#f7faf9`, surface `#f0f4f4`. Ink on saffron is `#16201f` — **white on saffron is banned**. Paragraph saffron on canvas uses `#a86800`.
- **IBM Plex Sans**, already self-hosted via `next/font` in `src/app/layout.tsx:2`. Do not add a font link.
- **Never hardcode a money string.** Every price, deadline, and allowance derives from config. Three hardcoded-price defects were caught in design review.
- **The member allowance is per household (1–9), never "4".**
- **No refunds, including no-shows.** No screen may promise money back.
- **A volunteer never decides and never refuses** — judgement calls route to a board member present at the event.
- **No PHI. No per-attendee personal data** in this flow; the only name collected is the family name for the door.
- Money is integer cents. Every billable thing is a `LineItem`. `confirmOrderPaid` is the single confirmation point.

## Decisions locked

| Question | Decision |
|---|---|
| Ticket model | Not an open question — `Event.collectsAttendeeDetails` already switches per event. Quantity/anonymous for Navratri; the camp keeps per-person. The handoff's "decide before building" is stale. |
| Sessions | One event, three items. No session entity, no scanner toggle. |
| RoN payment rail | **Stripe cart line item** (as built). Zelle stays vendors + sponsorship only, per `docs/Payment-Gateway.md`. The handoff's "RoN by Zelle" is reverted. |
| Vendor booth flow | **Follow-up plan.** Vendors keep the interest form + offline Zelle for Oct 10. |
| Medical camp | Absent from the designs by request. **Unchanged in code** — schema, stations, labs, badges all stay. |
| Pricing | Configurable per item: early-bird (until a deadline) → online → door. Any may be unset. |
| Payment override | Routes into `docs/Payment-Gateway.md` §5 (reason codes, separate role flag). **Do not build a second waiver path.** |

---

# Phase A — Pricing becomes configuration

### Task A1: One price resolver, three prices

Today the door-price rule is a lambda duplicated verbatim in two places (`src/server/gate.ts:260` and `:335`), and the online price is read raw in two more. Adding a third price to four independent read sites is how they drift.

**Files**
- Create: `src/lib/pricing.ts`
- Modify: `prisma/schema.prisma` (`ServiceCap`), new migration
- Modify: `src/server/registration.ts:192`, `:224`, `:281`
- Modify: `src/server/gate.ts:260`, `:335` (delete both lambdas)
- Modify: `src/app/register/page.tsx:50`

**Schema**
```prisma
model ServiceCap {
  /// Promotional price, charged online until earlyBirdUntil. Null = no early bird.
  earlyBirdPriceCents Int?
  /// Deadline for earlyBirdPriceCents. Null = no early bird.
  earlyBirdUntil      DateTime?
}
```
Migration adds two nullable columns; no backfill needed — null means the phase doesn't exist.

**Contract**
```ts
export type PriceChannel = "online" | "door";
export type PricePhase = "early-bird" | "online" | "door";
export type ResolvedPrice = {
  amountCents: number;
  phase: PricePhase;
  /** Set only when an early-bird window is open. Drives the phase strip. */
  earlyBirdEndsAt: Date | null;
  /** Set when a later, higher price exists. Drives "then $20 at the door". */
  nextAmountCents: number | null;
};

export function resolvePrice(
  cap: { priceCents: number; onsitePriceCents: number | null;
         earlyBirdPriceCents: number | null; earlyBirdUntil: Date | null },
  channel: PriceChannel,
  now: Date,
): ResolvedPrice;
```
Rules: `door` → `onsitePriceCents ?? priceCents`, ignoring early bird (an early-bird deadline is an *advance-purchase* promotion). `online` → `earlyBirdPriceCents` when both early-bird fields are set and `now < earlyBirdUntil`, else `priceCents`.

**Why it matters:** `src/app/register/page.tsx` feeds display prices to the client while `src/server/registration.ts` computes the authoritative total. If they resolve differently the customer sees one number and is charged another. Both must call `resolvePrice`.

**Verify:** extend `scripts/verify-pricing.ts` with an early-bird cap — assert online-before-deadline, online-after-deadline, and that the door price ignores the early bird entirely.

### Task A2: Admin can set all three prices

**Files:** `src/app/admin/camps/[id]/services/actions.ts` (`RowInput`, `onsiteCents`, `createService`, `saveServiceRow`), `page.tsx:86-94`, `ServicesManager.tsx`

Add `earlyBirdPriceDollars: number | null` and `earlyBirdUntil: string | null` to `RowInput`, following the existing `onsiteCents` null-not-zero convention. Design reference: Operations "Service & pricing config" — the three kinds must read as distinctly here as in the cart, with each kind's consequence in plain language.

**Reject** an early-bird price with no deadline, or a deadline with no price — half a phase is a silent mispricing. Return the existing `{ ok: false, error }` shape.

### Task A3: The gate can sell a fee — fix the unreachable `fees` bucket

**Bug introduced earlier today.** `getGateCatalog` returns `{ admission, merch, fees }` (`src/server/gate.ts:351`), but `type Catalog` in `src/app/gate/GateStation.tsx:19` declares only `admission` and `merch`. Structural typing lets it compile, so **competition entries are silently unsellable at the door** despite full server support.

**Files:** `src/app/gate/GateStation.tsx:19`, and the `WalkUpForm` item picker at `:424-482`.

Add `fees` to the type and render it as a third group, visually distinct per the design's third-kind treatment (`#fff7e6` ground, `#a86800` border, "NOT A TICKET · NO FLOOR ACCESS").

---

# Phase B — The real event exists

### Task B1: Teach `seed-events.ts` about ticketed events

`prisma/seed-events.ts` cannot express the Oct 10 event today. Its `Seed` type (`:24-48`) has no `status`, no services, and none of the event-config flags; `status: "OPEN"` is hardcoded at `:178`, and service caps are created **only** for `type === "CAMP"` (`:214`).

**Files:** `prisma/seed-events.ts`

Extend `Seed`:
```ts
status?: "DRAFT" | "OPEN" | "ACTIVE";       // default "OPEN" (current behaviour)
collectsAttendeeDetails?: boolean;
honorsMembership?: boolean;
acceptsDonations?: boolean;
allowsRefunds?: boolean;
services?: {
  key: string; name: string; colorHex: string;
  priceCents: number; onsitePriceCents?: number;
  earlyBirdPriceCents?: number; earlyBirdUntil?: string;
  admits: boolean; fulfillable: boolean; capacity: number;
}[];
```
Then upsert each service by `orgId_key` and create its cap — model on `prisma/seed-test.ts:606-654`, but **set `admits` explicitly**: the test seed omits it, so `dandiya-sticks` currently defaults to `admits: true` and is both merch and admission.

**Add the real event.** Correct `DAN-2026` (currently "Dandiya", Sep 27, no location) to the actual evening:

```
code: "RON-2026"        name: "Rhythm of Navratri"
Oct 10 2026, doors 4:30 PM, competition 5:00 PM  (store 2026-10-10T21:30Z → 2026-10-11T04:00Z)
location: "McKamy Middle School, Flower Mound, TX"
collectsAttendeeDetails: false   honorsMembership: true
acceptsDonations: true           allowsRefunds: false
services:
  floor-admission     admits    $15 online / $20 door   capacity per venue
  dandiya-sticks      merch     $5 per pair
  competition-entry   fee       $30 per group           admits:false fulfillable:false
```
All prices are **tentative** and coordinator-editable — this seeds a starting point, not a constant.

### Task B2: De-conflict the test fixture

Two problems, both in `prisma/seed-test.ts`:

1. `GB-2026W` "Dandia Night 2026" is `ACTIVE` on **2026-10-10** (`:633-648`) — the same night as the real event. `getActiveGeneralEvent()` (`src/server/gate.ts:45`) orders by `startsAt: "desc"` and takes one, so the gate could staff the fixture.
2. `:157-160` demotes **every** ACTIVE event whose code isn't `MC-2027S` to `CLOSED` — including a real ACTIVE event added in Task B1, and it runs on every push to test via CI.

Move `GB-2026W` well into the past and off `ACTIVE`, and narrow the demote to `type: "CAMP"` so it stops reaching across to general events.

**Also document the ordering hazard** in the file header: `db:seed` → `db:seed:events` → `db:seed:test`. `seed-events.ts:170` deletes **all** events in the org, so running it after `seed-test` destroys the fixtures.

---

# Phase C — The public list tells the truth

### Task C1: Past events stop selling

`src/app/events/page.tsx:43` filters on `status: OPEN | ACTIVE` with no date condition, and `src/app/register/page.tsx:20` will happily open a checkout for a finished event.

Add `endsAt: { gte: new Date() }` to both. Use `endsAt`, not `startsAt`, so an event in progress stays visible through the night.

### Task C2: Empty and past states

Design: Operations 12–13. Empty is never a bare box — it states the seasonal rhythm (Diwali early November, Holi in March, registration ~6 weeks ahead) with a notify-me action. Past shows the just-finished event dimmed with attendance and thanks, and states that **past tickets no longer scan**.

---

# Phase D — Member self-verification

The largest phase, and sequenced so the event ships without it if the roster cleanup doesn't land. **Blocked on:** committee poll 4 (roster cleanup owner). The roster today is 323 households — 65 current, 30 with no usable email.

### Task D1: Schema

**Files:** `prisma/schema.prisma`, migration

```prisma
model MemberVerification {
  id         String   @id @default(cuid())
  orgId      String
  org        Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  email      String
  codeHash   String            // sha256(code + secret). Never store the code.
  expiresAt  DateTime
  attempts   Int      @default(0)
  consumedAt DateTime?
  createdAt  DateTime @default(now())
  @@index([orgId, email])
}

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
  memberId              String?   // set when a verified member checked out
  memberClaimUnverified Boolean @default(false)
  @@index([orgId, registrantEmail])   // roster join; currently a seq scan
}

model Member {
  userId String?          // seam for the eventual portal. Non-unique.
  @@index([orgId, userId])
}
```

Do **not** reuse NextAuth's `VerificationToken` — its `identifier` is global (a cross-tenant membership oracle) and it has no attempt counter.

**Email casing:** `src/app/admin/members/actions.ts:23` lowercases; `src/server/registration.ts` does not. Normalise to lowercase on write in the registration path and match case-insensitively everywhere.

### Task D2: Rate limiting

There is no rate limiter, no Redis, no KV anywhere in the repo. Add a Postgres token bucket — atomic via a single conditional `UPDATE`, durable, and already in the stack.

**Files:** create `src/lib/rateLimit.ts`, `prisma/schema.prisma`

```ts
export async function takeToken(
  key: string, limit: number, windowSeconds: number, now: Date,
): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
```

Limits: 3 codes per email per hour; 10 sends and 30 verifies per IP per hour; 200 sends per event per hour as a circuit breaker; 60s resend floor. Client IP comes from `x-forwarded-for` via `headers()` — a new pattern here, so put it in one helper.

### Task D3: Issue and verify a code

**Files:** create `src/server/memberVerification.ts`, `src/app/register/member-actions.ts`

```ts
export async function requestMemberCode(email: string, ip: string | null)
  : Promise<{ sent: boolean; retryAfterSeconds: number }>;
export async function verifyMemberCode(email: string, code: string, ip: string | null)
  : Promise<{ ok: true; memberId: string; allowance: number; expired: boolean }
           | { ok: false; attemptsRemaining: number }>;
```

**Never confirm or deny roll membership.** Look the member up first and only send when one exists — but return an identical response either way. This also protects SES reputation: codes are never sprayed at addresses outside a roster we control.

6-digit numeric, 30-minute expiry, 5 attempts then burn the code.

**Session:** on success set an httpOnly cookie holding `{orgId, memberId}` via `cookies()` from `next/headers`. Two notes from the survey: `cookies()` is used **nowhere** in this codebase today, and there is **no HMAC/JWT/signing helper** — `NEXTAUTH_SECRET` is optional in `src/lib/env.ts:28`, so add a required secret rather than assuming it. Simplest safe option: store an opaque random token server-side (the precedent is `randomUUID()` twice in `src/app/api/test-login/route.ts:68`) and put only the token in the cookie.

Public actions carry **no** `require*()` call — that is the only thing that makes them public. Keep these pages outside the `src/middleware.ts:46` matcher or the action POST gets bounced.

### Task D4: The code email

**Files:** `src/lib/email.ts`

Emails here are **plain text only** — there is no HTML template helper; each function builds `string[]` and joins with `\n`. Follow that.

Critical: `dispatch()` (`src/lib/email.ts:144`) swallows all errors and returns `void`. A code flow must know whether the send failed — use `send()` directly or add a result-returning variant. Also note that with no provider configured the **full body, including the code, is written to the logs** (`:128-134`), and `EMAIL_PROVIDER` defaults to `resend`, which is a stub.

Wording per design state 11: *"If this address is on our membership list, this code will confirm it."* Handle the unrequested-email case and the two-codes case (newest wins).

### Task D5: Comp allocation and the claim

**Files:** `src/server/registration.ts`, `src/server/payments.ts`

The allowance is `min(member.partySize - alreadyUsed, floorQty)`, applied **only** to `admits` services — never sticks, never the fee. An unverified visitor has an allowance of **0**.

Create the `MemberComp` row when the order is **priced**, not at confirmation: two concurrent checkouts would both price at $0 and the second would fail *after* the member paid. Release on cancel or TTL. Set the Stripe session `expires_at` to 30 minutes (it currently defaults to 24 hours) and use the same TTL for the claim.

**Re-validate the claim inside the `PENDING → CONFIRMED` transaction, but never fail a paid order there.** If the claim was lost, honour the comp and flag it for the coordinator. Failing costs a real payment; honouring costs one admission.

### Task D6: Checkout UI, states 03–11

Per `DCICA Member Checkout.dc.html`. The three item kinds must read as visibly different; the competition trap (`comp > 0 && floor === 0`) shows the navy warning panel with the one-tap fix and is **not** a blocking modal. The comp result is a ledger, not a rejection. Full-comp orders skip payment entirely and still itemise.

Follow the existing public-form pattern exactly: typed object args (not `FormData`), `{ ok } | { ok: false, error }` results, `useState` + `useTransition`, `window.location.href` on success. Reference: `src/app/register/RegisterForm.tsx:135-163`.

Persist cart and email to local storage — the offline banner promises nothing is lost.

---

# Phase E — Event night

### Task E1: An audit trail exists at all

There is **no** audit model in the schema, and the gate records almost nothing about who did what. `Attendee` has `checkedInAt` but no actor. `compAdmit` accepts a `userId` and literally discards it (`src/server/gate.ts:199`: `void userId`). The only actor attribution in the entire gate is `LineItem.fulfilledByUserId`.

```prisma
model GateEvent {
  id         String   @id @default(cuid())
  orgId      String
  eventId    String
  attendeeId String?
  orderId    String?
  kind       GateEventKind   // ADMIT | UNDO_ADMIT | COMP | SELL | FULFILL | OVERRIDE
  byUserId   String
  reason     String?
  meta       Json     @default("{}")
  createdAt  DateTime @default(now())
  @@index([orgId, eventId, createdAt])
}
```
Write one row from every gate action. This is the precondition for undo, for close-out, and for the override log.

### Task E2: Undo a scan

Nothing in `src/` ever sets `checkedInAt` back to null for an attendee. A mis-scan is permanent and inflates the headcount forever.

**Files:** `src/server/gate.ts`, `src/app/gate/actions.ts`, `GateStation.tsx`

```ts
export async function undoAdmit(attendeeId: string, userId: string): Promise<void>;
```
2-minute window from `checkedInAt`; past that, a coordinator corrects it. Write an `UNDO_ADMIT` audit row. Design: Events 15 states the consequence before it is tapped — *"their code becomes valid again and the door count drops by one."* Events 16 puts a 48px undo button on every row of the last-scans log, which is where a mis-scan is actually noticed.

Also: the "already admitted" branch in `GateStation.tsx` is currently a dead end offering no action. Undo belongs there.

### Task E3: Cash that counts

`confirmGateCash(orderId, tenderedCents?)` accepts a tender, but all three till actions call it with one argument — so `Payment.cashTenderedCents` is always null and no change is ever computed. `changeDueCents` in `src/lib/money.ts` is unused.

Wire the tender through and build the design's screen: quick-tender buttons, change due at 30px+ in flag-green, short tender in saffron with dark ink reading "Short $12", and till attribution. Hidden entirely from volunteers without a till (`requireTill`, `src/server/session.ts:71`).

**While here:** the gate cannot sell quantity — `sellAtGate` never sets `LineItem.quantity`, so it's always 1 and "3 pairs of sticks" is impossible at the door. Add a quantity per picked item.

**Also:** every walk-up cash sale currently fires a confirmation email to `gate@gate.local` (`src/server/payments.ts:284`). Skip the send for gate-local addresses.

### Task E4: Comp at the door, done properly

`compAdmit` today creates a $0 CONFIRMED order with **no line items, no payment, no ledger entry, and no capacity decrement** — comps are invisible to both reconciliation and capacity. It clamps 1–4 regardless of the household's actual allowance, verifies no membership, and records no actor.

Rework it to: look up the household, use its real allowance less anything already claimed, write `LineItem`s at `amountCents: 0` against the admission service so capacity decrements, route through `confirmOrderPaid` with `method: COMP`, write the `MemberComp` row, and record the actor.

Widen `ConfirmInput.method` to include `COMP`.

**Ledger:** record a comp as a matched `CREDIT` + `DEBIT` pair at list price with `method: COMP`, so cash never moves, totals still foot, and the treasurer can read revenue foregone.

**The collision case** — the household already claimed online — is the one that matters. Per design: the volunteer is never the one who says no.

**Headcount must count admissions, not scans.** `getEventHeadcount` (`src/server/gate.ts:308`) counts every attendee with a non-null `checkedInAt`. But `createQuantityOrder` mints a fallback "receipt" attendee for an order containing no admission units (`src/server/registration.ts:302`) — so a group that buys only a competition entry, or only sticks, inflates the floor count the moment they scan at the desk. Count attendees whose order carries an `admits` line item. The gate view must also show entitlement plainly — "Competition entry — no floor access" — so the volunteer reads it in under two seconds.

### Task E5: Payment override and the board hand-off

`docs/Payment-Gateway.md` §5 already defines this: mandatory reason codes (financial hardship / volunteer or staff / committee decision / complimentary / other-with-note), an audit trail against user and timestamp, an override log on the coordinator dashboard, and a close-out section. **None of it is built.**

**Important distinction the design conflated:** `Membership.canOverrideWaiver` exists, but its schema comment scopes it to *waiver* override, and §5 says payment-override authority is a **separate** flag from till access. Add `canOverridePayment` rather than overloading the waiver flag — conflating "can skip a signature" with "can give away money" is a governance error, not a naming quibble.

Screens: the volunteer's says only someone with override authority can waive and a reason is required; the board member completes the five reason codes on their own phone.

### Task E6: Close-out and reconciliation

Design: Operations 09. Gross, then by payment method, then **cash counted against expected per till** with the variance row and short tills tinted saffron, then comped admissions as revenue foregone, competition fees, and sticks sold vs handed over. Export, then signing off locks the event.

Builds on `src/server/dashboard.ts:157` `getReconciliationRows()` and `src/app/api/reports/reconciliation/route.ts`.

---

# Phase F — Operations surfaces

### Task F1: Event lifecycle controls

`transitionCamp` (`src/app/admin/camps/actions.ts`) already enforces the state machine. This is the UI: a progress list with the current state tinted, each transition stating its consequence as separate lines before it is tapped, and the live-obstacle warning (*"3 volunteers are still on the clock"*). Coordinator-only, logged with name and time.

### Task F2: Event-scoped membership roster

Design: Operations 01–03. Reuse `searchMembers` (`src/app/admin/membership/actions.ts:26`) rather than duplicating the query — it already does name/email/phone OR-matching with the digits heuristic.

Add the event scope and the per-row order state: not yet purchased / purchased with what / arrived. Filter chips are real queries: All, No order found, Paid full with allowance left, Checked in. The middle two are what a coordinator works the phones from.

**The join is by email string** — `Member` has no FK to `Order`; `confirmOrderPaid` matches on `orgId_email` against `registrantEmail`. So a member who checked out under another address shows as unmatched. Copy is always **"No order found under this email"**, never "hasn't bought", and screen 03 offers manual linking with candidate matches and a reason for each ("Phone matches this household"). Linking is reversible and logged, and sets `Order.memberId`.

Two real roster states to build, not idealise: no email on file, and expiry never recorded (*"treat as current and ask the membership chair"*). Lifetime reads as **"Lifetime"**, never a date.

### Task F3: Volunteer module UI

Functionally complete already (`src/server/volunteers.ts`, `docs/Volunteer-Module.md`). Design: Operations 04–07 — signup with capacity bars, coordinator roster with late-volunteer tinting and a Call action, a dark outdoor check-in/out screen with the volunteer's own clock large, and hours plus certificate.

---

## Verification

No test framework exists — a deliberate call given the deadline. Standing up Vitest now costs days the defect list needs; add it after the event, when the payment code stops moving.

1. **`npm run verify:pricing`** — extend per phase. It currently runs 16 assertions and cleans up after itself. Add: early-bird resolution across the deadline, comp allocation against a real household allowance, once-per-event claim enforcement, and a fee issuing no ticket at the door.
2. **`npx tsc --noEmit`** after every task.
3. **Stripe test-mode pass on the deployed test env** — a real checkout and a real webhook, then check the ledger row. The pricing script asserts the checkout invariant but does not exercise the Stripe SDK.
4. **Gate rehearsal on two real phones** — scan, undo, comp, cash with change, and a fee sale. This is the only way to catch the two-phones-diverging-headcount problem (`GateStation` holds the count in local `useState` and never polls).
5. **Seed order check:** `db:seed` → `db:seed:events` → `db:seed:test`, then confirm `/api/health` and that the gate resolves the real Oct 10 event, not the fixture.

## Risks and open items

- **Committee poll 2** (household allowance policy) and **poll 4** (roster cleanup owner) are unanswered. Poll 4 gates Phase D — the flow is only as good as the roster, and 80% of it currently reads as expired.
- **Two review lenses argued against building member verification at all** for this event, given no fraud exists in a small known group and 30 households have no usable email. The client elected to build it after hearing that. It is sequenced last.
- **Network at the venue is the biggest night-of risk** — every scan, comp, and cash sale is a round trip, and there is no offline mode. Print a paper roster, and decide in advance who owns the "network is down, take cash and write names" call.
- **`getGateView` is not scoped to the active event** (`src/server/gate.ts:66`) — a ticket from another event in the same org resolves and can be admitted. Worth closing while in Phase E.
