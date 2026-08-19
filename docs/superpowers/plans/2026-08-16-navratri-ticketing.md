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
| Merchandise at Navratri | **Three items only: admission, dandiya sticks, competition entry.** No event T-shirt — dropped by the client 2026-08-17 and un-offered from the fixture event. B1 must not seed one. |
| Admin catalogue clutter | **Accepted as-is.** The services screen lists all org-wide services with an "Offered at this camp" checkbox; medical-camp services appear on the Navratri screen unchecked and marked "(hidden from this event's registration)". Client reviewed and elected to leave it. Do not add a filter/collapse task. |
| Phase order | **B → C → E → D.** Event night (E) precedes member verification (D): E holds live defects, D is blocked on committee poll 4, and if D never ships members are comped at the door exactly as they are today. The plan's own risk section already said verification is "sequenced last"; the letters were wrong, not the sentence. |
| Opened door beats the clock (Ruling 15) | A finished event stops selling — **but** the date test applies to `OPEN` only. `ACTIVE` **plus** a non-null `walkInOpensAt` overrides it, because that pair is a coordinator's deliberate act *today*. Without this a half-day camp overrunning its window loses walk-in registration mid-camp: `gate.ts` is `type: "GENERAL"` only, so a CAMP has **no door sell path** and `/register` *is* its walk-in path. |
| Display timezone | **One shared constant now (`VENUE_TIME_ZONE = "America/Chicago"` in `src/lib/eventTime.ts`), an `Organization` setting later.** Never a fixed offset — wrong for half the year. Same treatment as `CONTACT_EMAIL`: one source, documented as owing a settings home. |
| Empty/past state omissions (Rulings 17–19) | The design assumes three systems that do not exist. **Photos and competition results:** omitted, not stubbed — no model, no upload path. **Notify-me:** a contact link, and Ruling 4's premise was wrong — there is no `/contact` route, only the footer `mailto`; "Text me" would mean SMS consent with no sender. **Attendance:** rendered only when the count exceeds zero, because the org's real past events are non-ticketed and would read "0 people came — thank you". |
| Garba class (Sept 19 2026) | Seeded, not entered through the admin UI, because the admin UI **cannot** create a general event (see Phase G). Online $5.50 / door $5.00 — deliberately inverted so the card fee is passed to the buyer. `honorsMembership` **off**: a family plan's `partySize` of 5 would comp the whole household on a $5 class. Capacity **40 is a placeholder** pending the real number from the flyer's contacts. |
| Email HTML | Only the **order confirmation** gains an HTML part. The OTP email (D4) and the three volunteer senders stay plain text. The QR is a `cid:` inline attachment via SESv2 `Content.Raw`, **not** a hosted image — a hosted image needs a round trip at open time and so fails the airplane-mode test (D-2), and Gmail strips `data:` URIs. |
| `Event.code` is not editable | It is the prefix of every minted ticket (`GARBA-2026-0015`). Changing it after tickets exist orphans every code already in a guest's inbox and on their badge. Not offered as a field on the edit form. |

---

## Execution status (2026-08-19)

Branch `feat/navratri-ticketing`, continuously fast-forwarded into `test` and
deployed to test.dcica.org. **17 commits landed; the plan grew from 26 tasks to 36**
as execution surfaced work the plan had not anticipated.

Gates: `npx tsc --noEmit` clean · `npm run verify` = **74 checks** (39 pricing +
35 validation, both self-cleaning) · roster intact at 323 households.

| Phase | Done | Pending |
|---|---|---|
| **A** pricing is configuration | A1 · A2 · A3 | — |
| **B** the real event exists | B1 · B2 · **B3** | — |
| **C** the public list tells the truth | C1 · **C1b** · **C1c** · C2 · **C2b** · **C3** · **C4** | — |
| **D** member self-verification | — | D1 · D2 · D3 · D4 · D5 · D6 — **blocked on committee poll 4** |
| **E** event night | E10 | **E1 · E2 · E3 · E4 · E5 · E6 · E7 · E8 · E9** |
| **F** operations surfaces | F3 | F1 · F2 · F4 |
| **G** discovered during execution | G1 · G2 · G3 · G4 · G5 | G6 · G7 (below) |

Tasks added during execution, and why — each was a defect or a client request the
plan did not foresee:

| Task | Why it exists |
|---|---|
| **B3** | `db:seed:events` wiped every event in the org on each run |
| **C1b** | Ruling 15 (above), plus Stripe's `cancel_url` dropped buyers on the wrong event |
| **C1c** | Ruling 15 made `status === "ACTIVE"` load-bearing with nothing asserting it — a plausible refactor would have made **every closed camp sellable**. Also removed a wall-clock time bomb that would have killed the test suite in December. |
| **C2b** | The past-events band read as an inventory with no thanks; the contact address lived in three files |
| **C3** | `/register`'s help copy read **no** event flag — it promised money back on a no-refunds event, gave per-person instructions in quantity mode, and showed lab copy on a dance night |
| **C4** | Comments and copy that asserted things the code disproved, incl. "sold-out services are disabled" — untrue on every event |
| **G1** | Buyer email/phone were never validated during entry, and a bad email rendered a raw `ZodError` JSON dump in the red box |
| **G2** | Seed the Sept 19 Garba class (client request from a printed flyer) |
| **G3** | `updateCamp` was fully written and **orphaned** — no UI called it, so an event's name, dates and location needed a code change and a deploy |
| **G4** | **No** date/time call site pinned a timezone — a real event stored correctly at 20:00Z rendered as 8:00 PM on Vercel against a flyer saying 3:00 PM |
| **G5** | A bogus `eventId` returned a ~456-char Prisma dump with absolute source paths; whitespace-only name and phone passed validation |
| **E10** | The confirmation email was four lines of plain text and a link |

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

Three problems, all in `prisma/seed-test.ts`:

1. `GB-2026W` "Dandia Night 2026" is `ACTIVE` on **2026-10-10** (`:633-648`) — the same night as the real event. `getActiveGeneralEvent()` (`src/server/gate.ts:45`) orders by `startsAt: "desc"` and takes one, so the gate could staff the fixture.
2. `:157-160` demotes **every** ACTIVE event whose code isn't `MC-2027S` to `CLOSED` — including a real ACTIVE event added in Task B1, and it runs on every push to test via CI.
3. **The fixtures misrepresent the ticket model** (ledger F6, found in the day-of simulation). Each Dandia order gets exactly ONE attendee regardless of quantity: "Ravi Kapoor" paid for 2 admission units and has 1 code; "The Kapoor Family" COMP'd 4 and has 1 code. Real orders mint one code per unit — verified against a live Stripe purchase — so the fixtures under-count bodies in the room by 5 and **cannot exercise wave arrival at all**, which is the one thing the gate most needs rehearsed. Mint one attendee per admission unit, matching `createQuantityOrder` (`src/server/registration.ts`), and give at least one fixture order 5 units so a 2+2+1 arrival can be practised without a card.

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

**Also — a walk-up sale admits regardless of what was sold.** Found by Task A3's reviewer, 2026-08-17. `sellAndAdmit` (`src/app/gate/actions.ts:83-98`) calls `admitAttendee` on every attendee a walk-up sale creates, and `sellAtGate` always creates one for a no-`attendeeId` sale. So selling **only** a competition entry — or only a pair of sticks — stamps `checkedInAt`, increments the headcount, and shows the volunteer a button reading "Take cash $30 & admit."

That directly contradicts the promise Task A3's own caption makes on the same screen (`NOT A TICKET · NO FLOOR ACCESS`). The defect is pre-existing — merch-only door sales have always auto-admitted — and A3's brief explicitly forbade touching it, which is why it lands here.

Gate the admit on the sale actually containing an `admits` item:

- No admission item in the sale → do not call `admitAttendee`, do not stamp `checkedInAt`, and label the button **"Take cash $30"** with no "& admit".
- Admission present → unchanged behaviour.

This is separate from E4's headcount fix and neither substitutes for the other: E4 stops a receipt-only attendee being *counted*, while this stops one being *admitted* in the first place. Fixing only E4 leaves wrong `checkedInAt` data and a lying button; fixing only this leaves the existing bad rows counted.

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

### Task E7: Merch hands over in waves

**Found in the 2026-08-17 day-of simulation (ledger F1, F3). Not in the original plan.**

The 4 stick pairs of a real order are ONE `LineItem` with `quantity: 4`, and `fulfillLineItems` stamps a single `fulfilledAt` on the line. The gate therefore shows one checkbox — "Dandiya Sticks ×4" — and one button, "Hand over selected (1)", which marks all four at once. The client's actual requirement is *"2 now, 2 later, as they request."* Today that is impossible.

Compounding it (F3): every one of the five scans on that order offered the same unfulfilled "Dandiya Sticks ×4". Fulfilment is idempotent so the DB cannot double-issue, but two volunteers on two doors can physically hand out 8 pairs before either taps the button.

**Files:** `prisma/schema.prisma` + migration, `src/server/gate.ts` (`fulfillLineItems`, `getGateView`), `src/app/gate/actions.ts`, `src/app/gate/GateStation.tsx`

```prisma
model LineItem {
  /// Units physically handed over. 0 = none, == quantity = complete.
  /// fulfilledAt is set only when fulfilledQty reaches quantity.
  fulfilledQty Int @default(0)
}
```

Migration backfills `fulfilledQty = quantity` where `fulfilledAt IS NOT NULL`, else 0 — so lines already handed over stay complete.

```ts
export async function fulfillLineItems(
  items: { lineItemId: string; qty: number }[],
  userId: string,
): Promise<void>;
```
Clamp each `qty` to `quantity - fulfilledQty` and reject a negative. Set `fulfilledAt` only on reaching `quantity`. Write a `FULFILL` audit row per call carrying the qty (Task E1), so "who gave out which pairs" survives the night.

`getGateView` must return `remainingQty` per merch line, and the gate row reads **"Dandiya Sticks — 2 of 4 handed over · 2 left"** with a stepper defaulting to the remaining count. A fully handed-over line shows as done and is not selectable. This is also the F3 fix: a second volunteer sees "2 left", not "×4".

**Verify:** in `scripts/verify-pricing.ts` — hand over 1 of 4, assert `fulfilledQty = 1` and `fulfilledAt` still null; hand over 3 more, assert complete; attempt a 5th, assert it is rejected or clamped and the total never exceeds `quantity`.

### Task E8: The gate shows the party, not just the person

**Found in the day-of simulation (ledger F2).**

Scanning one of five codes on one order shows "Guest / GB-2026W-0009" and nothing else. The volunteer cannot see that four more people on this order are still outside, nor that a code being re-presented belongs to a party already through. Design Events 13 specifies exactly this line, and it is the control that stops a party of five being waved in on one scan.

**Files:** `src/server/gate.ts` (`getGateView`), `src/app/gate/GateStation.tsx`

Return the order's admission siblings with the view: total admission units, how many are `checkedInAt`-stamped, and this attendee's position. Render above the primary action:

**THIS PARTY — 1 of 5 in · 4 still to scan**

After admitting, it reads 2 of 5. For a single-unit order the line is suppressed rather than reading "1 of 1". For an order with **no** admission line it reads the entitlement plainly — **"Competition entry — no floor access"** — which is the same copy Task E4 needs for the headcount fix, so build it once here.

### Task E9: The door pass shows its own state

**Found in the day-of simulation (ledger F4).**

`/confirm/<orderId>` renders a QR per `campId` but never reads `checkedInAt`. A family of five at the door cannot see which of their tickets are already in, so a re-presented phone looks identical to an unused one.

**Files:** `src/app/confirm/[orderId]/page.tsx`

Per ticket: the QR, the code, and a state chip — **Not yet scanned** (navy outline) / **Admitted 6:42 PM** (flag-green), with the QR de-emphasised once admitted so the eye lands on the unused ones. Header carries the party line from E8 in the guest's own words. Merch reads its `fulfilledQty` from E7 — **"Dandiya sticks: 2 of 4 collected."** No refund language anywhere on this page.

### Task E10: The confirmation email carries the pass

**Found in the day-of simulation (ledger F5). Raises what Task D4 assumed.**

`src/lib/email.ts` has **no HTML part anywhere** — every function builds `string[]`, joins with `\n`, and sends SES `Content.Simple.Body.Text`. The confirmation body is four lines: name, event, camp IDs, a link. Design Operations 10 requires the email to *carry* the pass, and a guest in a school gym with no signal cannot open a link.

**Files:** `src/lib/email.ts`, `src/server/payments.ts` (the confirmation send site)

Add an HTML part alongside the existing text part — `Content.Simple.Body.Html` plus `Text`, never HTML alone, so text clients and the no-provider log path both still work. Keep the text part exactly as it is today; it is the fallback, not the deliverable.

The QR must be **embedded, not linked** — a `cid:` inline attachment requires SES `SendRawEmail`/MIME, which this codebase does not do; a `data:` URI is blocked by Gmail. So: switch this one send to a raw MIME message with the QR PNGs as inline attachments, generated server-side with the `qrcode` package already in `dependencies`. If that proves too large a change for the window, the fallback is one QR per ticket rendered as a hosted image route — write down which you chose and why.

Body carries, in order: party name and headcount, each ticket's code + QR, a PAID block itemising what was bought, sticks to collect, venue and doors time, and the no-refunds line. Keep it single-column, inline-styled, tables not flexbox — this is email, the design system's border-radius rule and palette still apply but the layout technology does not.

**Task D4's scope is unchanged by this** — the OTP code email stays plain text. Only the order confirmation gains an HTML layer.

---

# Phase F — Operations surfaces

### Task F1: Event lifecycle controls

`transitionCamp` (`src/app/admin/camps/actions.ts`) already enforces the state machine. This is the UI: a progress list with the current state tinted, each transition stating its consequence as separate lines before it is tapped, and the live-obstacle warning (*"3 volunteers are still on the clock"*). Coordinator-only, logged with name and time.

### Task F2: Event-scoped membership roster

Design: Operations 01–03. Reuse `searchMembers` (`src/app/admin/membership/actions.ts:26`) rather than duplicating the query — it already does name/email/phone OR-matching with the digits heuristic.

Add the event scope and the per-row order state: not yet purchased / purchased with what / arrived. Filter chips are real queries: All, No order found, Paid full with allowance left, Checked in. The middle two are what a coordinator works the phones from.

**The join is by email string** — `Member` has no FK to `Order`; `confirmOrderPaid` matches on `orgId_email` against `registrantEmail`. So a member who checked out under another address shows as unmatched. Copy is always **"No order found under this email"**, never "hasn't bought", and screen 03 offers manual linking with candidate matches and a reason for each ("Phone matches this household"). Linking is reversible and logged, and sets `Order.memberId`.

Two real roster states to build, not idealise: no email on file, and expiry never recorded (*"treat as current and ask the membership chair"*). Lifetime reads as **"Lifetime"**, never a date.

### Task F3: Seeds must not overwrite coordinator configuration

Found by the B1/B2 review, 2026-08-17. Both `seed-events.ts` and `seed-test.ts` upsert `ServiceType` rows with an `update` half that rewrites `name`, `colorHex`, and `priceCents`. So **any coordinator edit to a service's display fields is silently reverted by the next seed run** — and where two scripts share a key (`dandiya-sticks` is the same org-scoped key in both files), whichever ran last wins.

This bears directly on the configuration-over-code mandate: a coordinator is told these are their settings, and a routine `db:seed` takes them back. Blast radius is dev and CI today, since neither seed runs against production — which is exactly why it is cheap to fix now rather than after someone loses an afternoon's configuration.

Narrow each seed's `update` half to the fields it genuinely owns (identity and the three-kind flags), and stop rewriting display fields on rows that already exist. Also record in each file's header which fields the seed considers authoritative.

### Task F4: Volunteer module UI

Functionally complete already (`src/server/volunteers.ts`, `docs/Volunteer-Module.md`). Design: Operations 04–07 — signup with capacity bars, coordinator roster with late-volunteer tinting and a Call action, a dark outdoor check-in/out screen with the volunteer's own clock large, and hours plus certificate.

---

# Phase G — discovered during execution

Not in the original plan. Each of these was either a defect found while doing
something else, or a client request that arrived mid-flight. G1–G5 have landed and
been reviewed; G6 and G7 are open.

### Task G6: the services screen corrupts the early-bird deadline (OPEN)

The same defect G4 fixed on the read side and G3 fixed on the camp write side is
**still live on the services screen**, and here it gates money.
`services/page.tsx:12` `toDatetimeLocal` builds the input from `getHours()` — the
*process* zone, in a server component — and `services/actions.ts:75` parses it back
with `new Date(until!)`. Self-consistent, so it round-trips and no test catches it.

On Vercel a coordinator typing a deadline of `23:59` stores `23:59Z`, which is
**6:59 PM** in Flower Mound. `earlyBirdUntil` gates the discount in `resolvePrice`,
so **the early-bird window closes five hours early and buyers pay full price.**

Latent today — no event currently sets early bird — and it fires the moment anyone
uses the feature Phase A exists for. Test-plan **A-4** explicitly exercises setting
that deadline through the UI. The fix is the two `eventTime.ts` helpers G3 added,
two imports away.

Fold in four comment corrections in `src/lib/eventTime.ts` that the G3 review
disproved: the spring-forward gap resolves one hour **earlier**, not later; the
two-pass offset iteration **oscillates with period 2** inside the gap rather than
converging; `hourCycle: "h23"` prevents a **±12-hour** error at every hour from
13:00, not just a midnight break; and the "moving `endsAt` closes online sales"
sentence is **false** for `ACTIVE` + walk-in-open events (Ruling 15), which is the
state the fixture it was written against is in. Plus: the edit form never re-syncs
from its props after a save, so a server-normalised value leaves the field showing
what was typed — a `key` closes it.

### Task G7: the admin UI cannot create a general event (OPEN)

`createCamp` hardcodes `type: "CAMP"`, and its code validator
`/^[A-Z]{2,4}-\d{4}[SW]$/` **rejects 7 of the org's 10 existing event codes** in
three distinct ways: the mandatory `S`/`W` season letter kills every general code
*and* `MC-2027`; the `{2,4}` cap kills `GARBA-2026`; letters-only kills
`JUL4-2026`. Location is settable nowhere on the create path.

So **7 of 10 events in the database could not be created through the product.** This
is why the Garba class had to be seeded. It is also test-plan case **A-1**, which is
a go-live gate item and fails today on its first assertion.

Deliberately separated from G3 because changing which codes are accepted alters
validation semantics and deserves its own review. `parseCampId` shares the same
three failure modes (benign — both call sites fall back to the raw string) and
should be folded in.

---

## Verification

**Full test plan: `docs/Test-Plan-Navratri.md`** — six suites (admin/setup, buying, the door, the pass, reconciliation, rehearsal), a per-task gate table, and the go-live gate. Read it before starting any task; it names what that task's completion requires.

No test framework exists — a deliberate call given the deadline. Standing up Vitest now costs days the defect list needs; add it after the event, when the payment code stops moving. Coverage comes from four layers instead:

1. **`npx tsc --noEmit`** after every task.
2. **`npm run verify`** — the aggregate, **74 checks** as of 2026-08-19, both suites self-cleaning:
   - **`npm run verify:pricing`** — **39** assertions (was 16 at baseline, then 28; any note saying 30 was a miscount). Covers the three prices, the early-bird boundary, and the full online sell/no-sell rule across the four statuses A-6 specifies.
   - **`npm run verify:validation`** — **35** assertions. The negative-path sibling: bad form entries, buyer-visible error copy, and no-internal-leak properties. It caught two live defects (the Prisma path leak and whitespace-only contact details) and must never be made green by softening a row.
   - Still to add per phase: comp allocation against a real household allowance, once-per-event claim enforcement, a fee issuing no ticket at the door, and `fulfilledQty` partial hand-over (Task E7).
3. **Browser (Playwright) per phase** — the only layer that can reach the admin surfaces at all, because every admin action calls `requireAdmin()`/`requireCoordinator()` and a tsx script has no session. Includes a real Stripe test checkout with a real webhook.
4. **Two real phones, on-site rehearsal** — two doors scanning at once, network loss mid-scan, legibility in gym lighting. `GateStation` holds the headcount in local `useState` and never polls, so a two-device divergence is unreachable from a single browser by construction.

**Setup is tested through the UI, not the seed.** The night runs on what a coordinator typed into `/admin/camps/[id]/services`, so the real Oct 10 event must be configured through those forms at least once before go-live. `db:seed:events` produces a starting point for development; it is not the go-live path.

**Seed order is load-bearing:** `db:seed` → `db:seed:events` → `db:seed:test`. Run in that order every time.

**Correction (Task B3, 2026-08-19):** the warning that `seed-events.ts` "deletes all events in the org" is **obsolete**. B3 removed the `deleteMany`; F3 made the update half a no-op without `SEED_FORCE_UPDATE=1`, and `Event.status` is create-only in every mode. Three consecutive CI pushes have now run migrate plus all three seeds against a shared environment and destroyed nothing, reverted no coordinator edit, and left the live event's status alone. That is what made seeding shared environments safe.

**But a seed cannot correct an existing row.** `seed.ts` upserts with `update: {}` and has no force-update escape hatch, so `MC-2026W` on test.dcica.org still carries a wrong time that **no redeploy will fix** — it needs a data correction, now finally possible through Task G3's edit form. `seed-test.ts` is the opposite: it deletes and recreates its fixture, so `db:seed:test` *does* correct `MC-2027S` — while cascading away every order and attendee beneath it.

## Risks and open items

- **Phase E is entirely unbuilt except E10, and it is where the Oct 10 risk lives.** Every one of E1–E9 is a defect *observed firing in a browser* during the day-of simulation, not a hypothesis: no audit trail at all, a mis-scan that cannot be undone, cash tender never stored so no change is ever computed, comps invisible to reconciliation and capacity, a fee-only door sale that still admits, merch that cannot be handed over in waves, and a confirm page that tells an already-admitted family to go check in.
- **The Garba class (Sept 19 2026) is selling now**, which reorders priorities: it is one month out against Navratri's seven weeks, and a mis-scan at its door is currently permanent and unattributable. **E1 and E2 matter for that event, not just for Oct 10.**
- **Committee poll 2** (household allowance policy) and **poll 4** (roster cleanup owner) are unanswered. Poll 4 gates Phase D — the flow is only as good as the roster, and 80% of it currently reads as expired.
- **No public membership path exists.** The platform sells annual/multi-year membership and comps admissions off it, but a visitor who wants to join has nowhere to go except email. Phase D builds member *verification*, not *acquisition*. Not in the 36 tasks.
- **Garba capacity is a guess.** 40 is a placeholder; the flyer shouts "LIMITED ENTRIES" and the real number has to come from Madhu Rana or Abha Joshi. Editable through the services screen today.
- **The flyer directs payment to Zelle** (`Dentoncica@gmail.com`) while the platform sells the same tickets through Stripe. `docs/Payment-Gateway.md` scopes Zelle to vendors and sponsors, so money arriving that way will not reconcile against these tickets.
- **A personal address is the public contact.** `sachin@buzzclan.com` is now reached from the events empty state's primary CTA as well as every page footer. A committee alias behind a shared mailbox belongs on the pre-launch list; the code side is already one constant (`src/lib/contact.ts`).
- **Vercel Preview deployments are non-functional** — the Preview environment has no env vars at all, so Prisma cannot initialise and NextAuth refuses to start. `DATABASE_URL` and `NEXTAUTH_SECRET` are the two load-bearing ones; `dev` and `staging` schemas are migrated and seeded and ready to point at. Note the earlier diagnosis blaming the empty schemas was wrong about causation.
- **Buyer-facing follow-ups logged from reviews, none blocking:** email is the only untrimmed required field (56 cases where the client accepts and the server rejects, all pasted addresses with surrounding whitespace); a server rejection does not mark the field it is about; `role="alert"` is inserted with its content rather than updated, an iOS VoiceOver soft spot on the platform this targets; zero-width characters still defeat the badge on both sides; the attendee-name input is still bare; the mailing-address field renders even on events with no lab service.
- **Two review lenses argued against building member verification at all** for this event, given no fraud exists in a small known group and 30 households have no usable email. The client elected to build it after hearing that. It is sequenced last.
- **Network at the venue is the biggest night-of risk** — every scan, comp, and cash sale is a round trip, and there is no offline mode. Print a paper roster, and decide in advance who owns the "network is down, take cash and write names" call.
- **`getGateView` is not scoped to the active event** (`src/server/gate.ts:66`) — a ticket from another event in the same org resolves and can be admitted. Worth closing while in Phase E.
