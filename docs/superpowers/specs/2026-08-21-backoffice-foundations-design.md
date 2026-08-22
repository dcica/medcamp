# Backoffice foundations — design

Status: proposed
Date: 2026-08-21
Covers: service model, event lifecycle, event selection, progress/readiness, roles & navigation
Companion: `2026-08-21-performance-roster-design.md` (depends on the progress function defined here)

## Problem

A UX pass over the admin console as each role, against live test data, found that the
back office cannot answer two questions it exists to answer: **what is happening now**
and **what does this event sell**. Everything below follows from those two.

The evidence, all observed rather than inferred:

```
ACTIVE GB-2026W    -160d  svc:3/3  stn:0 vol:0 reg:21  $541.00
       !! 160 days PAST, still ACTIVE
OPEN   JUL4-2026    -49d  svc:0/0  !! PAST, still OPEN  !! sells nothing
OPEN   IND-2026      -6d  svc:0/0  !! PAST, still OPEN  !! sells nothing
OPEN   GARBA-2026    29d  sold:25/40  $238.50        <- invisible in the console
OPEN   RON-2026      50d  early bird ends in 10d     <- invisible in the console
OPEN   DIW-2026      64d  !! competition-entry capacity 0 (charges, then fails)
OPEN   HOLI-2027    212d  !! sells nothing
OPEN   MC-2027      288d  !! camp with 0 stations
```

None of those `!!` lines appears anywhere in the UI.

### Five root causes

**1. Nothing can close an event.** The lifecycle panel offers only *Start day-of* and
*Back to draft*. There is no Close. Yet the codebase calls the CLOSED transition
"load-bearing rather than housekeeping" — it is what stops a finished event owning the
default registration page. The UI made the required action impossible, so five events
are stale.

**2. Event selection is a guess.** `getActiveCamp` (src/server/stations.ts:17) is:

```ts
db.event.findFirst({ where: { orgId, type: "CAMP", status: "ACTIVE" } })
  ?? db.event.findFirst({ where: { orgId, type: "CAMP", status: "OPEN" } })
```

`type: "CAMP"` excludes every general event, so Garba, RoN, Dandiya and Diwali can
**never** appear on the coordinator dashboard or the station picker. There is no date
bound, so a June-2027 fixture wins today. There is no `orderBy`, so with two ACTIVE
events the row returned is arbitrary. The `?? OPEN` fallback presents an event a year
out as though it were running.

**3. The service screen is catalogue-first.** Opening Services for the Diwali festival
renders the whole org catalogue — Bloodwork, Dental Check, Vision Screening, General
Consult — twelve rows, every one fully expanded, roughly 100 controls, for an event
that sells exactly one thing. The screen answers "here is everything the org sells,
tick what applies" when the question is "what does this event sell". That inversion is
how a dance competition ended up attached to a medical camp.

**4. Service kind is three free booleans.** `admits`, `fulfillable` and `hasLab` are
independent checkboxes, but the domain has exactly three kinds. The seed already says
so: *"admits/fulfillable is a correctness invariant, not a coordinator preference."*
The UI presents it as preference and permits combinations that are nonsense.

**5. Every non-coordinator lands on `/403`.** Signing in as `volunteer`, `regdesk` or
`volcoord` authenticates successfully and redirects to Forbidden. All three then see an
identical menu — including "4. Coordinator Dashboard", which 403s them — while the page
each actually needs (`/gate` for the first two, `/volunteers` for the third) is absent
from it.

### 6. The console is a phone surface and was not built like one

Most back-office work happens on a phone. CLAUDE.md already requires it — 48px tap
targets, single column, no horizontal scroll, "coordinator dashboard readable on phone".
Measured at 375×812 against the live test site:

| Screen | Height | Controls | Targets < 44px | Nav hidden |
|---|---|---|---|---|
| `/admin/camps/[id]/services` | **8,983px** | **167** | **70** | 345px |
| `/admin/members` | 3,755px | 46 | 22 | 345px |
| `/admin` | 1,403px | 1 | 1 | 345px |
| `/dashboard` | 1,372px | 2 | 3 | — |
| `/admin/performances` | 899px | 1 | 0 | 345px |

**The admin tab bar hides 345px of itself on every admin page.** Seven tabs inside
`overflow-x-auto` (`AdminNav.tsx`) on a 375px screen: Membership, Email and Settings are
past the right edge with no scroll affordance. Roughly half the console's destinations
are invisible on the device most used to reach them.

**The services screen is ~24 phone-screens tall**, and its inputs render at 20px against
the mandated 48px.

The rule is applied inconsistently rather than absent: every screen written with
`min-h-tap` measures clean (performances 0 undersized, camps 0), while the older admin
forms use bare inputs. This is a per-screen omission, not a missing standard.

Three small targets on `/dashboard` matter despite the low count: "Live" (16px),
"Admin setup" (15px) and **"Export reconciliation CSV" (20px)** — the last is a money
action at under half the minimum.

## Goals

Make the wrong state unrepresentable where that is cheap, and visible where it is not.
Everything below is designed for a 6" phone first; the desktop is the same layout with
more room, never a different one.

## Non-goals

- Running order / show scheduling (companion spec).
- Multi-tenant org onboarding, RLS. Approach C still defers those.
- Visual redesign. The Modernist system in `docs/design_handoff_dcica_events/` is not
  adopted by the app (the app is Tailwind with rounded corners; the system specifies
  radius 0). That gap is real but separate, and not a UX defect.

---

## Part 1 — Service model

### 1.1 Kind becomes one value

```prisma
enum ServiceKind {
  ADMISSION // issues a scannable ticket, counts toward the door headcount
  MERCH     // a physical good handed over at the gate (will-call)
  FEE       // buys a slot, admits nobody — a competition entry
}
```

`ServiceType.kind` replaces the `admits` + `fulfillable` pair. `admitsCount` stays and
is meaningful only for `ADMISSION`. `hasLab` is orthogonal (it drives lab tracking and
the purge hold) and stays a boolean.

**Why an enum rather than better checkbox copy:** the bad state stops being storable.
The API, a seed script and any future screen all inherit the guarantee, instead of each
having to re-implement the rule. The migration is mechanical because the current pair
already encodes the kind:

| admits | fulfillable | → kind |
|---|---|---|
| true | false | ADMISSION |
| false | true | MERCH |
| false | false | FEE |
| true | true | **invalid** — migration must assert zero rows |

The migration asserts the invalid combination is empty before converting. (It is, on
both test and prod, as of 2026-08-21.)

### 1.2 Capacity stops meaning two things

`ServiceCap.capacity` is currently `Int` where `0` silently means "sells nothing" — and
worse, an offered service at capacity 0 **takes the payment and then fails to confirm**,
because `confirmOrder` gates on `sold <= capacity - qty` → `0 <= -1`. The buyer is
charged and gets nothing. Diwali is in that state now.

The screen compounds it: a service with **no cap row at all** also renders as `0`, so
one number means "unlimited-ish default", "not offered" and "will take money and fail"
depending on invisible context.

```prisma
capacity Int? // null = uncapped. 0 is rejected while the service is offered.
```

- `null` = uncapped, stated as "Unlimited" in the UI.
- A positive integer = a real cap.
- `0` while offered = refused at save, and flagged by readiness (Part 4) for rows that
  already exist.

**Migration is deliberately conservative.** Existing `capacity = 0` rows are NOT
auto-converted to `null`: silently making Diwali's competition entry unlimited would be
a guess about money. They are left as-is and surfaced as a readiness flag for a human
to resolve. Rows with no cap at all are unaffected — absence already means not offered.

### 1.3 The screen becomes event-owned

The Services page lists **only what this event sells**. Adding a service is a deliberate
act: an "Add service" control that opens the org catalogue as a picker.

- Kind renders as one choice (Admission / Merchandise / Entry fee), not three checkboxes.
- Capacity offers "Unlimited" explicitly alongside a number.
- **Catalogue editing leaves this page.** Editing a service's name, colour or kind is an
  org-wide act; doing it inside a single event's screen is what makes an org-wide edit
  look local. Today "Active" (org-wide) sits beside "Offered at this camp" (per-event)
  at identical visual weight — unticking Active to tidy Diwali removes that service from
  every event. Catalogue management moves to `/admin/services`.
- "Offered at this camp" disappears as a concept: presence in the list *is* offered;
  removal is an explicit remove.
- Copy stops saying "camp" for general events ("0 sold this camp" on a Diwali festival).

Also surfaced by the audit and worth fixing while here: the catalogue contains
**"Dandia Entry" ($25)** and **"Dandiya Entry" ($12)**, one letter apart, both
ADMISSION. The picker should warn on near-duplicate names.

**On a phone specifically.** The current screen is 8,983px of scroll and 167 controls
because it renders the whole catalogue fully expanded. Event-ownership fixes most of
that by arithmetic — Diwali goes from twelve expanded rows to one. The rest is layout:

- One **collapsed card per service** showing name, kind, price and capacity as read-only
  text. Tap to expand exactly one for editing; the others stay collapsed.
- Editing controls use `min-h-tap`. Today's 20px inputs are less than half the mandated
  48px, and price and capacity are money fields being thumbed on a phone.
- A single **sticky Save** for the expanded card, replacing twelve independent Save
  buttons with no unsaved-state indicator.
- Colour stops being a raw hex textbox (`#dc2626`) typed by hand, and stops being the
  first field on the card, ahead of the name.

Target: a coordinator can see everything an event sells without scrolling, and reach
any edit in one tap.

---

## Part 2 — Event lifecycle

### 2.1 Add the missing transition

The lifecycle panel gains **Close event** (ACTIVE|OPEN → CLOSED). This is the whole fix
for the stale-data problem: the transition was always required, and nothing offered it.

Closing asks for confirmation when the event has not yet reached its `endsAt`, since
closing early stops sales.

### 2.2 Detect staleness rather than rely on discipline

An event whose `endsAt` has passed while still OPEN or ACTIVE is flagged wherever it
appears — the camps list, the event detail, and the overview board — with the Close
action inline. Status is hand-set and drifts; the system should say so rather than wait
for someone to remember.

This is deliberately a *warning*, not an automatic transition. Auto-closing would fight
the documented case where an ACTIVE event legitimately runs past its scheduled end and
the gate is still scanning.

---

## Part 3 — Event selection

`getActiveCamp` is replaced by `getCurrentEvent(orgId)`, with the three defects fixed:

- **No type filter.** A general event is as real as a camp.
- **Date-bounded.** "Current" means happening now (`startsAt <= now <= endsAt`), not
  "someone set the status once".
- **Deterministic order.** `orderBy: { startsAt: "asc" }` so two candidates resolve the
  same way every time.

Resolution order:

1. An ACTIVE event whose window contains now.
2. An ACTIVE event with `walkInOpensAt` set (a coordinator deliberately opened a door;
   that outranks a scheduled end — the existing `isRegistrationOpen` ruling).
3. Nothing. **Returning null is a correct answer** and the surfaces must render it:
   today the dashboard would rather show a 2027 fixture than admit nothing is running.

The OPEN fallback is removed. An event that is merely selling is not "current" — it gets
the sales view (Part 4), not the day-of dashboard.

Callers: `/dashboard`, `/station`, `/station/[key]`.

---

## Part 4 — Progress and readiness

### 4.1 One function

Every signal needed already exists in the database; none of it is compared to anything.
A single pass computes all of it:

```ts
getEventProgress(orgId): Promise<EventProgress[]>
```

Per event: days until/since, offered service count, sold vs capacity, revenue, station
and volunteer-role counts, registration count, nearest early-bird deadline, and a
`flags[]` list.

Flags (each maps to an action):

| Flag | Meaning | Action |
|---|---|---|
| `PAST_BUT_LIVE` | `endsAt` passed, still OPEN/ACTIVE | Close event |
| `SELLS_NOTHING` | OPEN with no offered service | Add a service, or close |
| `OFFERED_AT_ZERO_CAP` | offered, capacity 0 | Set a capacity — takes money and fails |
| `CAMP_WITHOUT_STATIONS` | type CAMP, 0 stations | Configure the care spine |
| `NO_VOLUNTEER_ROLES` | 0 roles | Advisory only |
| `EARLY_BIRD_CLOSING` | deadline within 14 days | Advisory |

### 4.2 Where it goes

**Current-event indicator — a slim bar under the header, not in it.** A coordinator has
no persistent sense of what is live. It reads *"Now: Rhythm of Navratri — day-of"* or
*"Next: RoN in 50d"*, and is what makes a stale ACTIVE event impossible to ignore.

It must NOT go in the header itself: at 375px that row already holds the brand, Events
and Menu with nothing to spare, and an event name would either truncate to
uselessness or push Menu off-screen. A full-width bar below it costs one line, fits any
name, and is tappable at full width — which is the right target size for the most-used
link in the console.

**`/admin` — readiness board.** Leads with what is live, what is next, and what needs
attention (the flags, as one-click actions). Today it lists camps with raw counts.

**`/admin/camps` — progress on each event, as cards.** Days-until, sold/capacity,
revenue, warning dot. **Sorted soonest-first**; it is currently newest-first, so RoN
(the next real event) sits seventh of eleven.

Cards, not table rows: five columns of progress cannot fit 375px without either
horizontal scroll or type below the 16px floor, and both are already ruled out. Each
card is a single full-width tap target with the flag, if any, as its most prominent
element — a warning is the reason to open that event, so it should be what you see.

**`/admin/camps/[id]` — the counts line becomes a checklist.** `1 services · 0 stations
· 0 registered` states facts without saying whether they are enough. It becomes
services ✓ / every offered service priced and capacity set ✗ / stations (camps only) /
volunteer roles / early-bird deadline.

**The checklist gates publication.** An event cannot move to OPEN while it sells nothing
or offers a service at capacity 0. That one gate would have caught Diwali, HOLI-2027,
JUL4-2026 and IND-2026.

**`/dashboard` — add progress to the day-of view.** It shows counts (22 registered, 19
checked in) but no progress: no percentage seen, no elapsed-vs-scheduled, no projected
finish. "19 of 22 checked in · 90 min into a 5-hour window" is the sentence a
coordinator needs.

**A sales view for OPEN events — new, and the largest gap.** An event that is selling
has no screen at all. Cap burn-down, revenue, early-bird countdown, days remaining.
Garba at 25/40 with $238.50 in, and RoN's ten-day deadline, are currently invisible.

---

## Part 5 — Roles and navigation

### 5.1 Land somewhere useful

Sign-in resolves a landing route from the member's role instead of a fixed target that
403s five of eight roles:

| Role | Lands on |
|---|---|
| COORDINATOR, COMMITTEE_ADMIN | `/dashboard` (or `/admin` when nothing is current) |
| REGISTRATION_TILL / _NO_TILL | `/register` |
| STATION_VOLUNTEER | `/station` |
| DOCTOR | `/station` |
| POS_TILL | `/gate` |
| VOLUNTEER_COORDINATOR | `/volunteers` |

### 5.2 The menu is the product's roadmap

`staffModules.ts` ships CLAUDE.md's build order verbatim as staff navigation: "1.
Registration Portal … 9. Volunteer Module". Four of the nine (`Supply Calculator`,
`Checklist`, `Lab Tracking`, `Venue Config`) point at `#` and render as **unlabeled
empty rows** — a screen reader gets four nameless list items.

Replace with a role-filtered list of destinations that exist. Drop the numbering: it
implies a sequence that means nothing at runtime and advertises what has not been built
to the people depending on the product. Add `/gate` (reachable by two roles, currently
absent) and `/admin/performances`. Distinguish `/volunteer` (public signup) from
`/volunteers` (coordinator roster) — the menu currently offers only the former under a
label that reads like the latter. Mark the current page.

Role-filtering also fixes this on a phone by removing rows rather than styling them:
a station volunteer's menu becomes two entries, not nine-minus-four-dead.

### 5.3 The admin tab bar hides half of itself

`AdminNav.tsx` lays seven tabs in `overflow-x-auto`. At 375px, **345px of navigation is
off-screen** — Membership, Email and Settings — with no scroll cue, on every admin page.
A horizontally scrolling tab bar is the pattern the phone-first constraint exists to
prevent: content that is present, reachable, and invisible.

Replace with a layout that shows every destination it has:

- Wrap to two rows at narrow widths rather than scrolling, so nothing is hidden; or
- Collapse to a single labelled control that opens the full list.

Wrapping is preferred — it costs one line and needs no interaction to reveal what
exists. Whichever is chosen, the test is that no admin destination is reachable only by
horizontal scroll at 375px.

---

## Migration plan

1. **Additive first.** Add `ServiceKind` enum and a nullable `kind` column; backfill
   from `admits`/`fulfillable` after asserting the invalid pair is empty. Widen
   `capacity` to `Int?`.
2. **Dual-read.** Server code reads `kind`, falling back to the boolean pair when null,
   so a deploy that lands before the backfill cannot break checkout.
3. **Drop the old columns** in a later migration once no reader references them.

Note the ordering lesson from 2026-08-21: the Vercel app deploy lands minutes before
the gated migration, and Prisma's default full-column select faults on columns that do
not exist yet. **Any migration adding columns to a table existing code reads must be
approved before the app deploy, or the reading code must ship in a later commit.**

## Verification

Extend `npm run verify` per the existing convention:

- `verify-services.ts` — kind round-trips; the invalid pair cannot be constructed;
  capacity 0 while offered is refused; uncapped (null) sells without limit.
- `verify-progress.ts` — each flag fires on a fixture built to trigger it, and only
  then; `getCurrentEvent` returns null when nothing is running, picks the general event
  when one is live, and is deterministic with two candidates.
- `verify-roles.ts` — every role's landing route is reachable by that role.

Phone conformance is a measurement, not a review opinion, and the numbers in "Problem 6"
came from a script. Add `verify-phone.ts` to keep them honest: at 375×812, for every
admin route, assert no element exceeds viewport width, no container hides content behind
`overflow-x`, and no interactive element is under 44px. It fails today on the services
screen (70), members (22), the tab bar (345px hidden) and three dashboard links — so it
lands red on purpose, in the style of `verify-validation.ts`, and goes green as each is
fixed.

## Open questions

- **`hasLab` on a FEE service** is currently expressible and meaningless. Constrain, or
  leave as advisory?
- **Near-duplicate catalogue names** ("Dandia" / "Dandiya") — warn only, or offer a
  merge? Merge touches sold history and is probably its own piece of work.
- **`/admin/settings`** is `Organization name` and `Brand color` — two fields for the
  whole org config of a multi-tenant platform. Out of scope here, but it is where
  per-tenant configuration is supposed to live.
