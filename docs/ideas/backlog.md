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

## D004 — Tap to Pay at the gate (card, not just cash)
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-10-03
- **Details:**
  Take card payment at the door. Today the gate is **cash or nothing**: "till vs
  no till" means *may record cash*, not *may take a card*. There is no Stripe
  control anywhere on `/scan`, and no Terminal / Tap-to-Pay code in `src/`.
  A walk-up who has no cash currently has to buy on their own phone through
  `/register` (hosted Stripe Checkout) and then be scanned like any other guest.
- **Why it is not already built:** this was a decision, not an oversight.
  Architecture decision 2026-06-19 locked **hosted Stripe Checkout, no native
  Tap-to-Pay**; the reasoning is recorded at `src/server/payments.ts`
  ("decision #7: hosted Checkout, no native build"). Revisiting it means
  revisiting that.
- **What it actually costs:** Stripe **Terminal SDK**, which is not a web API —
  Tap to Pay on iPhone/Android needs a native app or a WebView shell, plus
  reader/location provisioning in the Stripe account, plus a connection-token
  endpoint. It also interacts with Stripe **Connect** (Platform Mandate: each
  tenant connects its own account), so the reader has to be provisioned against
  the *connected* account, not the platform's.
- **Related:** `CLAUDE.md` still advertises "Terminal SDK + Tap to Pay on phone
  for walk-in POS" in the stack section — that line is **stale** and should be
  corrected or marked aspirational whichever way this goes.
  Gate cash path: `sellAndAdmit` / `confirmGateCash` in `src/server/gate.ts`,
  UI in `src/app/scan/GateMode.tsx` (WalkUpForm).
  Note the adjacent gap: there is **no tender/change capture** either —
  `Payment.cashTenderedCents` exists and `changeDueCents()` in
  `src/lib/money.ts` has zero call sites.

---

## D005 — Live event dashboard (the numbers a door actually asks for)
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-10-10
- **Details:**
  Every metric below was hand-queried against `prod` with a throwaway `tsx`
  script during Dandiya Night 2026, one question at a time, while the door was
  running. That is the spec: if it had to be scripted live, it belongs on a
  screen. Phone-first, per the UI constraint — a coordinator reads this standing
  up.

  **Headline**
  - Admitted / issued / still-to-arrive, where *admitted* MUST be
    `getEventHeadcount`'s definition (`attendee.checkedInAt != null`) or the
    number will disagree with the gate screen a volunteer is holding.
  - Effective attendance = scanned + walk-ups never scanned (see gotcha 1).
  - Gross takings, split by method.

  **Arrival curve** — arrivals bucketed by half hour. On the night this was the
  single most useful number: the 00:30 bucket took 111 people, the next took 1,
  which is the signal to stand the door team down. Nothing in the app shows it.

  **Sales mix** — orders and people by `PaymentMethod` (STRIPE / CASH / COMP /
  ZELLE / CHECK), because "131 orders" and "371 people" are different questions
  and reconciliation needs both.

  **Stripe reconciliation** — DB `CONFIRMED` + `STRIPE` orders vs completed
  Checkout Sessions on the live account, matched on `metadata.orderId`, with the
  delta shown. On the night this came out at 106 = 106, delta 0, which is the
  cheapest possible proof that no charge was captured without a confirmation.

  **Not-yet-arrived list** — the one that needed contact details: name, email,
  phone, `out/total`, split into "nobody arrived" vs "party partly in", sorted
  by heads outstanding. 48 of 65 outstanding sat on six names; a dashboard that
  surfaces those six is worth more than one that lists all 25 orders.

- **Gotchas the implementer will otherwise rediscover the hard way:**
  1. **Walk-up vs online is NOT `method`.** `sellAtGate` accepts
     `method: "STRIPE"`, so a card-at-the-door sale is a `STRIPE` order. The
     discriminator is `registrantEmail === "gate@gate.local"`. Filtering by
     method put 9 door sales in the "online" column on the night.
  2. **`LineItem.attendeeId` is null in practice** — lines hang off the ORDER.
     A per-attendee `lineItems` include returns empty and silently classifies
     every guest as "unclassified".
  3. **`Attendee` has no `createdAt`.** Use `checkedInAt`, or the order's.
  4. A locally-generated Prisma client against `prod` needs **explicit
     `select`** everywhere, or an unapplied migration faults the read with
     `P2022` (same hazard as `scripts/mint-offline-order.ts`, gotcha 1).

- **Related:** `getEventHeadcount` / `getGateCatalog` in `src/server/gate.ts`
  already compute pieces of this. `getTrackedEvents` in `src/server/events.ts`
  is the off-season version of the same idea and should probably grow into it
  rather than being replaced. Adjacent gaps found the same night, each its own
  decision: the member comp admits 1 where the plan says 5
  (`ServiceType.admitsCount` on the comped line governs it, so a `family-1yr`
  comping `floor-admission` admits one person while the same plan comping
  `dandiya-family-4` admits four); the door cannot sell a `MembershipPlan` at
  all; walk-up sales discard buyer email and phone
  (`registrantEmail: "gate@gate.local"` is hardcoded at `gate.ts:660`), so 16
  unscanned walk-ups were uncontactable; and `scripts/mint-offline-order.ts`
  prices from `cap.priceCents` (online), so a door sale recorded after the fact
  is priced below what was actually taken.

---

## D006 — Sleep the scanner camera after a few minutes idle
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-10-10
- **Details:**
  The gate camera runs continuously for the whole event on a volunteer's own
  phone. Dandiya 2026 ran roughly 22:00–01:00+ with long dead stretches either
  side of the rush — the 00:30 half hour took 111 people, the next took 1 — so
  the camera spends most of its life decoding an empty doorway and draining a
  battery nobody at the door can spare. Stop the stream after a few minutes with
  no decode; wake it on a tap.

- **The risk, and it is the whole design problem:** this deliberately recreates
  a failure already reported against this screen. `QrScanner.tsx` carries the
  note that a volunteer once "held up a ticket, nothing [happened]" because the
  camera had never started — a dark preview is indistinguishable from a live one
  at arm's length under queue pressure. An idle sleep manufactures that state on
  purpose, so the asleep affordance has to be unmissable and waking has to be
  one tap, not a permission re-prompt. Anything subtle here is worse than the
  battery it saves.

- **Do not let it become an auto-dismiss.** `src/lib/scanLatch.ts` has NO
  auto-dismiss timer by explicit design — a standing verdict changes only on a
  deliberate tap, because an incoming scan replacing a verdict is the original
  reported bug. Sleeping the camera must leave the latched verdict on screen
  untouched. Two timers on one screen, one of which must never exist: say so in
  the code.

- **Related:** `scannerRef.stop()` and the two `scanner.start()` paths already
  exist in `src/app/_components/QrScanner.tsx`, so the lifecycle control is
  there. Note that file's own warning first: a camera that starts and then
  restarts in a loop is IDENTICAL in the logs to one clean start, which is why
  the start path is run-numbered and traced — an idle cycle will make that
  tracing noisy, and the run counter probably needs to understand sleep/wake
  rather than counting it as a fresh mount. `src/lib/scanDebounce.ts` (3s
  duplicate suppression) is the existing "has anything happened recently"
  signal and is the natural place to hang the idle clock off.
  `scripts/verify-scan.ts` covers the latch state machine and would need a
  sleep/wake row.

---

## D007 — Pay-by-QR blocks the teller; card sales need to run in the background
- **Type:** Feature
- **Status:** PARKED
- **Captured:** 2026-10-10
- **Details:**
  Reported live at Dandiya 2026. The gate shows a QR, the guest scans it and
  pays hosted Checkout on their own phone — which means typing a card number,
  sometimes 3DS, at the guest's pace. The teller is held on that one transaction
  while the next guest is already standing there holding up a freshly minted
  ticket.

- **The concrete blocker, which is worse than "unclear":** while a card sale is
  open the camera is collapsed — `camCollapsed = task !== "none"`
  (`src/app/scan/GateMode.tsx:482`). The teller cannot scan the next person at
  all without abandoning the sale. The queue stops for as long as one guest
  takes to type a card number.

- **What already works, and the gap it leaves:** `pollCardSale` runs on a 2s
  interval and, on payment, admits and settles the verdict in one round trip.
  `abandonCardSale()` is safe by design — the order is deliberately left PENDING
  because the guest may be mid-payment, Stripe expires the session on its own
  and `checkout.session.expired` reaps it, and the webhook admits the guest
  regardless. So walking away costs the guest nothing. **But abandoning tears
  down the poll** (`stop = true; clearInterval`), so a payment that lands thirty
  seconds later is never observed by the screen. The guest gets in; the teller
  is never told. This is an information gap, not a money or admission bug.

- **Shape of the fix:** `cardSale` is a single slot — it needs to be a list.
  Several sales in flight at once, each polling in the background, the camera
  live throughout, and completion surfaced as a non-blocking notification
  ("Priya's party of 4 — paid, admitted") that the teller can acknowledge when
  they look up.

- **The constraint that must not be broken:** a background completion must NOT
  land in the main verdict band. `src/lib/scanLatch.ts` exists precisely because
  an incoming event replacing a standing verdict is the original reported bug —
  scan A reads ALREADY IN, something else fires, the banner flips to ADMITTED,
  and A is read as admitted. A card sale settling in the background is exactly
  that hazard wearing a new hat. It needs its own surface, separate from the
  verdict, and `scripts/verify-scan.ts` should pin that separation.

- **Related:** `pollCardSale` / `sellAtGate` (`method: "STRIPE"`) in
  `src/server/gate.ts`; card-sale state and the poll effect at
  `src/app/scan/GateMode.tsx:488-518`. Overlaps D004 (Tap to Pay) — if a native
  reader ever lands, the buyer-paced wait disappears and much of this with it,
  but pay-by-QR is the path that exists today. Also overlaps D006: an idle
  camera sleep must not fire while a background card sale is still pending.

---

## D008 — BUG: "Admit remaining N" re-arms as the primary after a partial admit
- **Type:** Bug
- **Status:** PARKED — highest severity of the 2026-10-10 batch
- **Captured:** 2026-10-10
- **Details:**
  Reported live at Dandiya 2026, after it nearly caused a physical altercation
  at the door.

  A split party arrives — six of a family of seventeen. The teller sets the
  stepper to 6 and taps the primary, "Admit 6 of 11". Correct so far. But
  `pendingParty.length` is a dependency of the effect at
  `src/app/scan/GateMode.tsx:560`, so the moment the admit lands the effect
  re-runs and `setAdmitN(Math.max(1, pendingParty.length))` resets the count to
  **everyone still outstanding**. The primary button relabels itself to "Admit
  remaining 5" and keeps the full-width primary slot — directly under the thumb
  that just tapped it. In queue rhythm the teller taps again, and five people
  who are not in the building are marked admitted.

  Those five then arrive, scan, and get `ALREADY_ADMITTED`: amber, "No wristband
  — ask before letting them through". A family that paid is refused at its own
  event by a screen that sounds certain. That is the brawl.

- **Why "Next guest" never rescues it:** `primary` is deliberately computed in
  one place so that "no action" promotes "Next guest" to the full-width primary
  (`GateMode.tsx:566-571`). A split party always has an action outstanding, so
  that promotion never fires. The single case that most needs *move on* is the
  only case structurally prevented from offering it.

- **The fix is about which action is primary, not about the stepper.** After an
  admit lands on a multi-ticket order, "Next guest" should take the primary
  slot and "Admit remaining N" should demote to secondary, requiring deliberate
  intent rather than inheriting the thumb's momentum. Resetting `admitN` to the
  full remainder is itself the wrong default on a *second* pass: the first tap
  is evidence that only some of the party is present.

- **Note the contradiction with the verdict module**, which already gets this
  right and should be the guide: `verdictFor`'s `PARTY_PARTIAL` case is
  explicitly `hold`, not `go`, on the reasoning that "two admitted out of five
  means the volunteer hands over TWO wristbands... the volunteer has to read a
  number rather than act on a colour" (`src/lib/scanVerdict.ts`). The verdict
  layer insists a partial party be read consciously; the button layer then
  hands back a one-tap way to admit the rest without reading anything.

- **Data consequence:** attendees wrongly marked `checkedInAt` inflate
  `getEventHeadcount` and corrupt the not-yet-arrived list — a party that never
  showed reads as present. Any attendance figure or no-show chase taken from
  2026-10-10 should be treated as an upper bound on admissions and a lower bound
  on no-shows. Several Dandiya orders sat at 9/10 and 2/3 admitted; some of
  those may be this bug rather than genuine stragglers.

- **Related:** `scripts/verify-gate.ts` and `scripts/verify-scan.ts` both cover
  party admission; neither pins which action holds the primary slot after a
  partial admit, which is why this shipped. A regression row there is the fix's
  companion. Adjacent to D005, whose no-show list is only as trustworthy as this
  bug allows.

---

## D009 — "Here is my card, charge me": record what was sold when the money bypasses the app
- **Type:** Feature
- **Status:** PARKED — wanted for the next event
- **Captured:** 2026-10-10
- **Details:**
  A guest holds out a card and the teller charges it on a standalone terminal.
  The money settles correctly; the app never hears about it. At Dandiya 2026
  this happened **20 times for $655** and produced roughly **40 people with no
  order, no campId, and no possibility of being scanned** — about 10% of the
  night's attendance, invisible to every figure the system reports.

- **The money was never the problem.** All 20 charges captured, no failures.
  What broke was the itemisation: with no order behind the charge, "what was
  this $87 for" had to be reverse-engineered afterwards from arithmetic
  ($15 adult / $12 child decompose uniquely for most totals, but $87 is
  1a+6c *or* 5a+1c and nothing in the data resolves it). Reconstructing a night
  from amount arithmetic is not a process anyone should repeat.

- **Two routes, and they are not equivalent:**
  1. **Take the card in the app** — D004, Tap to Pay. Collapses it to one
     action, but it is a native-app project: Terminal SDK is not a web API,
     needs a shell, reader/location provisioning, and interacts with Connect.
  2. **Record the itemisation for money taken elsewhere** — small, and fixes
     the damage that actually occurred. Recommended first.

- **Shape of (2):** a third payment button in the walk-up sheet — "card
  (terminal)" alongside Cash and Scan-to-pay — backed by a new `PaymentMethod`
  value. `sellAtGate` runs unchanged, so door pricing, `admitsCount`, campId
  minting and headcount are all correct by construction. The order is
  CONFIRMED with the money attributed to the external rail; the terminal export
  reconciles against it afterwards.
  Cost: double entry — the teller taps the terminal AND the app. That is the
  price of not waiting for D004.

- **Reconciliation is proven to work.** The Stripe unified payments export
  separates the rails perfectly: terminal charges carry a `card_…` card id with
  a BLANK customer email; app scan-to-pay carries `pm_…` with
  `gate@gate.local`. Verified 100% clean across 66 paid rows on the night, and
  the app side totalled $894.00 against the DB's $894.00 to the cent. A
  reconciliation report keyed on that discriminator is most of the work.

- **Related:** D004 (Tap to Pay) is the eventual collapse of this into one
  action. D005's dashboard should surface the external-rail total so the gap is
  visible during an event rather than discovered in a CSV afterwards. Note also
  that `scripts/mint-offline-order.ts` cannot currently be used to backfill
  these: it prices from `cap.priceCents` (online), so each $15 door adult
  records at $12 — about $51-63 light across tonight's 17-21 adults. Child
  tickets happen to be safe only because `dandiya-student` is $12 on both
  rails.
