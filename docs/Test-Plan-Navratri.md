# Rhythm of Navratri — Test Plan

**Event under test:** Oct 10 2026, McKamy Middle School, Flower Mound TX. Doors 4:30 PM, competition 5:00 PM.
**Plan:** `docs/superpowers/plans/2026-08-16-navratri-ticketing.md`
**Spec:** `docs/superpowers/specs/2026-08-16-navratri-ticketing-and-member-verification-design.md`

This plan covers three sellable items (floor admission, dandiya sticks, competition entry), the member comp path, the door, **and the admin/setup surfaces that configure all of it**. Setup is first-class here, not an afterthought: every price, cap, deadline, and allowance the night runs on is entered by a coordinator on an admin page. A pricing bug entered through the UI is indistinguishable, on the night, from a pricing bug in the resolver.

## Why the layers are shaped this way

There is **no test framework in this repo** — no Vitest, no Jest, no Playwright spec files on disk. That was a deliberate call given an 8-week window with money defects outstanding; standing up a framework costs days the defect list needs, and the payment code is still moving. The consequence is that coverage has to come from four deliberately-chosen layers rather than one suite, and each layer can only reach what its access to a session allows.

The dividing line that shapes everything below: **admin server actions call `requireAdmin()` / `requireCoordinator()`, which read a NextAuth session.** A `tsx` script has no session, so it cannot call them. Admin behaviour is therefore browser-tested (L2) or hand-tested (L3), never scripted (L1) — and L1's job at the admin boundary is to assert the *database state* the browser produced, plus the pure helpers the actions delegate to.

| Layer | Vehicle | Reaches | Cannot reach |
|---|---|---|---|
| **L0** | `npx tsc --noEmit` | Type drift across the whole tree | Anything about runtime behaviour |
| **L1** | `npm run verify:pricing` (tsx, direct DB) | Pure resolvers, server functions that take explicit args, DB invariants, reconciliation arithmetic | Anything behind a session; anything rendered |
| **L2** | Playwright MCP against a dev server | Every screen, every role, the real Stripe test flow, admin forms end-to-end | Two devices diverging at once; a real label printer; venue network |
| **L3** | Two real phones, on-site rehearsal | Concurrency at the door, printing, network loss, human legibility | Nothing else needs it — keep this layer small and specific |

L0 and L1 run after every task. L2 runs per phase. L3 runs twice: once when Phase E lands, once in the week before the event.

---

## Environment

**Never** run `prisma migrate dev` or `prisma migrate reset`. Use `prisma migrate diff` to author and `npm run db:migrate:deploy` to apply. The `dcica-pg` container holds the imported member roster (323 households) and the dev data this plan's verification depends on — wiping it costs a re-import, not a re-seed.

```
Docker Postgres   dcica-pg, host 127.0.0.1:5433  (do not recreate)
Worktree server   http://localhost:3200          (main tree runs on 3100)
DATABASE_URL      postgresql://postgres:postgres@127.0.0.1:5433/dcica
```

`NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` must both match the port the server is actually on, or Stripe returns the buyer to the wrong tree and the test-login cookie lands on the wrong origin. This has bitten once already.

### Seed order is load-bearing

```
npm run db:seed          # org, roles, service catalogue
npm run db:seed:events   # events incl. the real RON-2026 (Task B1)
npm run db:seed:test     # QA fixtures
```

Run in that order, every time. `prisma/seed-events.ts:170` **deletes all events in the org**, so running it *after* `db:seed:test` destroys the fixtures. And until Task B2 lands, `seed-test.ts:157-160` demotes every non-`MC-2027S` ACTIVE event to CLOSED — which silently closes the real Oct 10 event. Treat a "the gate says no active event" symptom as a seed-order symptom first.

### Test identities

`POST /api/test-login` with `{username, password}` mints a real NextAuth DB session for a role. Enabled by `TEST_LOGIN_ENABLED=true`, password `TEST_LOGIN_PASSWORD`. Usernames: `coordinator`, `regdesk`, `regdesk-notill`, `volunteer`, `doctor`, `pos`, `admin`, `volcoord` (`src/lib/testAccounts.ts`).

Two of these matter more than the rest for this event: `regdesk` (till, can take cash) and `regdesk-notill` (no till, Stripe only). The cash-visibility rule is a role test, not a UI test — see A-7.

### Stripe

Test mode. Success `4242 4242 4242 4242`, any future expiry, any CVC. Decline `4000 0000 0000 0002`. 3DS challenge `4000 0027 6000 3184`. Webhook signature locally comes from `STRIPE_WEBHOOK_SECRET`; for real delivery in dev use `stripe listen`.

**The webhook is the only authority on payment.** A browser that reaches `/confirm` proves nothing about the order's state. Every purchase test asserts the DB after the webhook, never the success page alone.

---

## Suite A — Admin / setup

The suite the user asked for, and the one with the least coverage today. Everything here runs as `coordinator` unless stated. All of it is L2 (browser) because of the session boundary described above, with L1 assertions on the resulting rows.

### A-1 · Create the event

`/admin/camps` → `CreateCampForm` → `createCamp`. Create a general event with a code, name, start and end, and a location.

Assert: it appears in the list; `type` is the general-event type, not `CAMP`; `status` is `DRAFT`.
**Negative:** duplicate code rejected with a readable error, not a Prisma unique-constraint stack trace. End before start rejected.

### A-2 · Event flags

`/admin/camps/[id]` → `EventFlags` → `setEventFlags`. For Navratri: `collectsAttendeeDetails` **off** (quantity/anonymous mode), `honorsMembership` **on**, `acceptsDonations` **on**, `allowsRefunds` **off**.

Assert each flag round-trips to the DB, then assert its *consequence* — this is the part worth testing, because a flag that saves but does not take effect looks identical in the admin UI:

- `collectsAttendeeDetails` off → `/register?event=<id>` shows a quantity picker, not per-person name rows.
- `honorsMembership` off → the comp allowance is 0 even for a verified member (guard against the comp path ignoring the flag).
- `allowsRefunds` off → no screen in the buyer's path promises money back. Grep the rendered pages for "refund" and read every hit.

### A-3 · Services and the three kinds — **highest-risk setup test**

`/admin/camps/[id]/services` → `createService` / `saveServiceRow`. The three kinds come from two independent booleans, and getting one wrong is silent:

| Item | `admits` | `fulfillable` | Consequence if mis-set |
|---|---|---|---|
| Floor admission | ✅ | ❌ | — |
| Dandiya sticks | ❌ | ✅ | `admits` on → sticks issue tickets and inflate headcount |
| Competition entry | ❌ | ❌ | `admits` on → a group with no floor access is admitted to the floor |

Create all three. Then assert at the DB (L1) that `admits`/`fulfillable` are exactly as above, and at the register page that admission is the only one that mints a code.

This is not hypothetical: `seed-test.ts` currently omits `admits`, so `dandiya-sticks` defaults to `admits: true` and is **both merch and admission** today. The fixture is the proof this test is needed.

### A-4 · Three prices, entered by hand

Set on floor admission: online $15, door $20, early-bird $12 until a date you control.

Assert (L1, via `resolvePrice`): before the deadline online resolves $12; after it, $15; the door resolves $20 **in both cases** — the early-bird deadline is an advance-purchase promotion, not a time-of-day discount, so the door deliberately ignores it. Then assert the two read sites agree: the price shown on `/register` and the price `createCheckoutForOrder` sends to Stripe must be the same number. They are computed in different files; that is exactly why this assertion exists.

**Negative — half a phase.** An early-bird price with no deadline, or a deadline with no price, must be **rejected** with `{ok: false, error}`. Half a phase is a silent mispricing, which is worse than a validation error. (Task A2.)

**Negative — blank is not zero.** Clear the door price and save. Assert the column is `NULL`, not `0`. A `0` here means free admission at the door; the `onsiteCents()` helper exists specifically to prevent this, and the test protects the helper.

### A-5 · Capacity caps

Set a capacity of 3 on some item. Sell 3. Assert the 4th purchase is refused **at payment confirmation**, not merely hidden in the UI — capacity is enforced atomically in `confirmOrderPaid`, and the register page's sold-out styling is a courtesy, not the control. Assert the refused buyer is not charged.

### A-6 · Lifecycle transitions

`CampControls` → `transitionCamp`, and `setWalkIn`. Walk the real path: `DRAFT → OPEN → ACTIVE → CLOSED`. Assert each illegal transition is refused by the server action even when driven directly, and assert the consequence of each legal one:

- `DRAFT` → `/register` refuses (no checkout offered).
- `OPEN` → online sales work; the gate has no active event.
- `ACTIVE` + `walkInOpensAt` set → the door sells; online still works.
- `CLOSED` → both refuse.

The register page and the submit action must agree on openness at every one of these states. They disagreed once — the page rendered a checkout the action then refused, a dead end for the buyer — which is why `isRegistrationOpen` is now a single shared predicate. This test is that bug's regression test.

### A-7 · Role and permission matrix

For each of the eight test accounts, hit `/admin`, `/admin/camps`, `/admin/camps/[id]/services`, `/admin/membership`, `/admin/settings`, `/gate`. Assert allow or deny per the CLAUDE.md role table.

Two specific assertions carry real money risk:

- **`regdesk-notill` never sees a cash option.** Not disabled — absent. Then call the cash action directly with that session and assert the *server* refuses. A hidden button is UI; `requireTill` is the control.
- **`volunteer` cannot reach any admin route**, and a station volunteer cannot comp an admission.

### A-8 · Membership setup

`/admin/membership` and `/admin/members`. Assert `partySize` is per-household and editable (1–9) and that nothing in the code or copy hardcodes 4. Assert a Lifetime membership renders as **"Lifetime"**, never as a date. Assert the two real roster states the imported data actually contains: no email on file, and expiry never recorded.

### A-9 · Email configuration

`/admin/email`. With no provider configured, the full body — **including any OTP code** — is written to the logs (`src/lib/email.ts:128-134`). Assert that is understood and not enabled anywhere reachable by a real member. Assert `EMAIL_PROVIDER=ses` is set for any environment where a real code will be sent; the default is `resend`, which is a stub.

---

## Suite B — Buying

### B-1 · The reference cart (regression-locked)

5 floor admissions + 4 stick pairs, `thejain@gmail.com`, card `4242…`. This exact cart has been run once and its numbers are now the regression baseline:

```
line items      5 × $15 + 4 × $5   = $105          ← at the pre-Oct online price
this run        5 × admission, 4 × sticks = $185   ← at the seeded fixture price
payment         = sum of line items × quantity
ledger CREDIT   = payment
codes minted    5   (one per admission unit, not one per order)
capacity sold   admission 5, sticks 4
```

The invariant, not the dollar figure, is what to assert: **line items × quantity == payment == ledger, and admission units == codes minted.** A quantity-blind Stripe total shipped once and would have charged **$40 for a $185 cart**; that is what this test exists to catch.

### B-2 · The competition entry admits nobody

Buy a competition entry alone. Assert: no ticket code is minted, the order confirms, and the buyer's pass reads **"Competition entry — no floor access"**. Then scan whatever the order produced at the gate and assert the floor headcount does **not** increase.

This is subtle and worth stating plainly: `createQuantityOrder` mints a fallback "receipt" attendee for an order with no admission units. `getEventHeadcount` counts every attendee with a `checkedInAt`. So a competition-only or sticks-only group inflates the floor count the moment they scan — unless the headcount counts admission line items instead of scans. Task E4.

**Blocked until Task B1.** No seeded service currently satisfies `admits: false, fulfillable: false, hasLab: false`, so nothing lands in the gate's `fees` bucket — the dandiya fixture defines admission plus two merch items and no fee at all. The only fee-kind service that has ever existed in the dev database is the transient `verify-fee` that `scripts/verify-pricing.ts` creates and self-deletes. Task A3 made the bucket reachable; B1 is what puts something in it. Until then this case is scripted-only.

### B-3 · Declines and abandonment

Decline card → order stays `PENDING`, nothing minted, no ledger row, no capacity consumed. Abandon at the Stripe page → same. **Specifically:** no `Member` row is created for an abandoned membership purchase. Free membership on an abandoned cart shipped once.

### B-4 · Member comp

Verified member, `partySize` N, buys N+2 admissions. Assert exactly N are comped at $0, the surplus 2 are charged, the comp applies **only** to `admits` items (never sticks, never the fee), and the itemisation shows the buyer what was comped rather than silently discounting.

Then run the same member again on the same event. Assert the second attempt gets **zero** allowance — once per member per event, enforced by the `(memberId, eventId)` unique key, not by a count in application code. An unbounded comp shipped once.

Expired member: renewal offered inline, then comped. Non-member and unknown email: identical response either way — the OTP flow must never confirm or deny membership.

---

## Suite C — The door

L2 for mechanics, **L3 for anything involving two devices**. `GateStation` holds the headcount in local `useState` and never polls, so a divergence between two phones is invisible to a single-browser test by construction.

### C-1 · Wave arrival — 2 + 2 + 1

The client's stated pattern. A party of 5 arrives in three waves; assert the count goes 0 → 2 → 4 → 5 and that the party line reads **"2 of 5 in · 3 still to scan"** at the middle step (Task E8). Re-present an already-scanned code and assert the volunteer is told so and offered undo, not left at a dead end.

Note for whoever runs this: until Task B2 fixes the fixtures, **this test cannot be run on seeded data at all** — the fixtures mint one attendee per order regardless of quantity, so a "party of 5" has one code. It needs either a real Stripe purchase or the B2 fix.

### C-2 · Sticks in waves

4 pairs, collected 2 now and 2 later. Assert `fulfilledQty` goes 0 → 2 → 4, that `fulfilledAt` is set **only** on reaching 4, that a 5th is clamped or refused, and that the second volunteer's screen reads "2 left" rather than "×4" (Tasks E7, F3).

### C-3 · Undo

Mis-scan, then undo inside the 2-minute window. Assert `checkedInAt` returns to null, the code becomes valid again, the headcount drops by one, and an `UNDO_ADMIT` audit row exists naming the actor. Past the window, assert a coordinator is required.

### C-4 · Cash with change

`regdesk` sells at the door with a tender above the price. Assert `Payment.cashTenderedCents` is stored and change due is computed and displayed. It is `null` on every path today because all three till actions call `confirmGateCash` with one argument. Also assert a short tender reads "Short $12" and that no confirmation email fires to `gate@gate.local`.

### C-5 · Comp at the door

Assert the comped admission produces line items at $0 so **capacity decrements**, a matched CREDIT+DEBIT ledger pair at list price so totals still foot and revenue foregone is readable, a `MemberComp` row, and a recorded actor. `compAdmit` today creates none of these — it discards its `userId` with `void userId`.

**The collision case is the one that matters:** the household already claimed online. The volunteer is never the one who says no — it routes to a board member present at the event.

### C-6 · Cross-event ticket

Present a valid ticket from a *different* event in the same org. Assert it is refused. `getGateView` is not scoped to the active event today, so it resolves and can be admitted.

---

## Suite D — The pass, in the guest's hands

### D-1 · Confirm page state

`/confirm/<orderId>` for a party of 5, two of them admitted. Assert per-ticket state chips — "Not yet scanned" vs "Admitted 6:42 PM" — and sticks reading "2 of 4 collected". Today the page renders 5 QR codes and reads `checkedInAt` for none of them, so a re-presented phone is indistinguishable from an unused one (Task E9).

### D-2 · Email carries the pass

Assert the confirmation email has **both** an HTML and a text part, that the QR is embedded rather than linked, and that it carries headcount, codes, the PAID itemisation, sticks to collect, venue, doors time, and the no-refunds line.

Then the test that actually matters: **put the phone in airplane mode and open the email.** A guest in a school gym with no signal cannot follow a link. That is the requirement; everything else about this email is detail.

The OTP code email stays plain text — do not assert HTML on that one.

---

## Suite E — Money reconciles

Run after every purchase suite, and once against the full night's data before sign-off.

- Gross == sum of payments == sum of ledger credits.
- Per method: Stripe, cash, comp. Cash counted against expected **per till**, with the variance row.
- Comps appear as revenue foregone at list price, and never as cash.
- Sticks sold vs handed over, with the gap explained by uncollected pairs, not by a bug.
- Export the reconciliation CSV and re-add it by hand once. Do this at least once; a report that foots against itself but not against reality is the classic failure here.

---

## Suite F — Rehearsal (L3)

Small, specific, and irreplaceable. Two real phones, the real venue if possible:

1. **Two doors at once.** Both phones scan different members of the same party simultaneously. Watch for diverging headcounts and for both volunteers being offered the same unfulfilled sticks.
2. **Network loss mid-scan.** Turn off WiFi during an admit. Assert nothing is half-committed. Then decide, in writing, who owns the "network is down, take cash and write names" call — and print the paper roster.
3. **Label printer**, if badges are in scope for this event.
4. **Legibility at arm's length, in gym lighting**, by someone who has not seen the screens before. If a volunteer needs more than two seconds to read entitlement, the copy is wrong regardless of what the code does.

---

## Per-task gate

No task is complete without its row:

| Task | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| A1 price resolver | ✅ | early-bird across deadline; door ignores it | — | — |
| A2 admin price fields | ✅ | resulting rows; NULL-not-zero | A-4 | — |
| A3 gate sells a fee | ✅ | — | B-2 | — |
| B1 real event seeded | ✅ | flags + 3 kinds + 3 prices on RON-2026 | A-1..A-4 | — |
| B2 fixtures | ✅ | one attendee per admission unit | C-1 | — |
| C1/C2 public list | ✅ | past event excluded by `endsAt` | events page states | — |
| D1–D6 member verification | ✅ | claim uniqueness; allowance arithmetic | B-4 | — |
| E1 audit trail | ✅ | a row per gate action | — | — |
| E2 undo | ✅ | `checkedInAt` nulled + audit row | C-3 | ✅ |
| E3 cash | ✅ | tender + change stored | C-4 | ✅ |
| E4 comp at door | ✅ | line items, ledger pair, capacity | C-5 | — |
| E5 override | ✅ | reason code required | role matrix | — |
| E6 close-out | ✅ | Suite E arithmetic | export read-back | — |
| **E7 partial fulfilment** | ✅ | `fulfilledQty` 0→2→4, clamp at 4 | C-2 | ✅ two doors |
| **E8 party context** | ✅ | sibling counts | C-1 | ✅ |
| **E9 confirm page state** | ✅ | — | D-1 | — |
| **E10 HTML email + QR** | ✅ | both parts present | D-2 | ✅ airplane mode |
| F1–F3 ops surfaces | ✅ | — | role matrix | — |

## Go-live gate

Ship only when all of these hold:

1. `npx tsc --noEmit` clean and `npm run verify:pricing` fully green.
2. Suite A complete — the real Oct 10 event configured **through the admin UI**, not through a seed script. The night runs on what a coordinator typed; test what a coordinator typed.
3. A real Stripe test purchase reconciling end to end, webhook included.
4. Suites C and D green, including waves in both directions — people in, sticks out.
5. Suite F run on two phones by two people who are not the developer.
6. A printed paper roster exists, and a named person owns the network-down call.

## Known gaps this plan does not close

Stated plainly rather than left implicit:

- **No offline mode.** Every scan, comp, and cash sale is a round trip. Mitigation is paper and a named decision-maker, not code.
- **Concurrency at the door is only rehearsal-tested.** Automating it needs two real browser contexts and a polling headcount; neither exists.
- **The member roster is the ceiling on member verification.** 323 households, 65 current, ~30 with no usable email. Committee poll 4 (cleanup owner) is unanswered and gates Phase D. No test can fix a roster.
