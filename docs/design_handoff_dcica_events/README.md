# Handoff: DCICA Events — Registration, Member Checkout & Door Check-in

## Overview

Two phone-first design prototypes for the Denton County India Cultural Association
(dcica.org), a volunteer-run non-profit in Flower Mound, TX. They cover the full
lifecycle of a DCICA event: an attendee finding and buying tickets, a member
proving membership to claim included admissions, a volunteer checking people in at
the door, an admin watching live numbers, and a food/retail vendor paying for a booth.

The driving problem: today this runs on Google Forms, Square, a WordPress site and
a printed sign-in sheet. Attendees are tracked manually at the door.

Two design decisions carry most of the value and must survive implementation:

1. **Sessions are ticketed separately.** A DCICA event evening has two parts — a
   group dance competition ("Rhythm of Navratri", flat fee per group), then the
   public dandiya floor. **Competition entry grants no floor access and issues no
   ticket.** Getting this wrong produces arguments at the door. The design states
   it in three places and actively warns when a cart contains competition entry
   with zero floor admissions.
2. **Tickets are anonymous and quantity-based** in the newer model — no per-attendee
   personal data. One scannable code covers a whole party. See "Two ticket models"
   below; this is an open decision.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes
showing intended look and behaviour. They are **not production code to copy**.

They are authored as "Design Components": a single `.dc.html` file with an inline
template plus a logic class, rendered by a proprietary runtime (`support.js`) that
is **not included and not available in your codebase**. Do not try to run them as-is
or port the `<sc-if>` / `{{ }}` template syntax.

Your task is to **recreate these designs in the target codebase's existing
environment** — React, Next.js, Vue, native, whatever is already there — using its
established component library, routing and state patterns. If no frontend exists
yet, choose the framework that best fits the rest of the stack and build there.

Open the `.dc.html` files in a browser to view the designs; a left sidebar in each
file navigates between screens.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, copy and interaction states.
Recreate the UI faithfully using the codebase's existing libraries. Every hex value,
font size and tap-target minimum in this document is deliberate.

Interactive behaviour in the prototypes is real, not faked: quantity steppers
recompute totals, the membership comp arithmetic is live, the 6-digit keypad fills
the code boxes, the resend button counts down from 60s, and the copy buttons write
to the clipboard.

---

## Platform constraints (non-negotiable)

These came from the client as hard build rules.

- **Phone-first.** Every screen must work on a 6" phone with **no pinch-zoom and no
  horizontal scroll**. Design frame is **390 × 844**. Single column throughout.
- **Minimum tap target 48px.** Volunteer-facing primary actions are **56px**.
  Steppers are 48–54px. Volunteers use these one-handed, outdoors, in bright sun or
  a dark gym.
- **Audience range is teenagers to grandparents**, many not fluent with app flows.
  Copy is plain, error states are lanes rather than walls, and nothing depends on a
  learned gesture.
- **No PHI, ever.** The medical camp stores name, phone and paid services only — no
  diagnoses, results, clinical notes or insurance. Lab results go from the lab
  directly to the member; DCICA never holds them. Any screen that implies clinical
  data must be removed.
- **Cash is a real payment path**, not an edge case. Day-of walk-ins pay cash; the
  UI must show amount tendered and change due, in large type. Cash is hidden from
  volunteers who don't hold a till (permission-gated).
- **Network resilience.** Every state must survive a slow or dropped connection
  mid-checkout without losing the cart. The door pass must work with no signal.
- **Membership never confirmed or denied by email lookup.** Security requirement:
  the system must not reveal whether an address is on the membership roll. Every
  email submission returns the same neutral response.

---

## Pricing is configuration, not constants

Each item carries up to three prices, resolved in this order:

```
early bird (until a configured deadline)  ->  online  ->  at the door
```

For Navratri the intent is **$15 online / $20 at the door**, with an optional
early bird. **Any of the three may be unset**, and the UI must read correctly
either way — a phase strip states which price is active and what happens next
("$20 at the door" / "Same price at the door"). Never hardcode a price, a
deadline, or the existence of a deadline into copy. In the prototypes this is
driven by `pricePhase`, `onlinePrice`, `doorPrice`, `earlyBirdPrice`,
`earlyBirdUntil`.

Three hardcoded-price defects were caught during review (a door pass asserting
`$30 · card`, a comp action saying `Take $60`, a refusal button saying
`Sell floor ticket · $40`). **Derive every money string from config.**

## One event, three items — not two sessions

The evening is **one event**. The 4:00 PM competition and the 7:15 PM floor are
**presentational times, not separately-ticketed sessions**. Consequences that are
load-bearing:

- The scanner has **no session toggle**.
- The refusal case is *"this code carries no floor admission"*, never "wrong session".
- Event setup configures **items**, never sessions — there is no add-a-session affordance.

The three items:

| Item | Price | Unit | Kind |
|---|---|---|---|
| Floor admission | configured set | per person | **Issues a scannable ticket** |
| Dandiya sticks | $5 | per pair | **Collected at the door**, no ticket |
| Dance competition entry | $30 | **per group, any number of dancers** | **No ticket, no floor access** |

## The member allowance is per household, 1 to 9

Never "4". It is stored per household and the live roster runs 1–9, may be
partly consumed by an earlier order for the same event, and may be **fully
consumed**. All allowance copy must be derived. Comps apply **only** to floor
admission — never to sticks or competition entry — and **only after a verified
membership**; an unverified visitor has an allowance of 0.

## Refunds: there are none

Organisation policy is **no refunds, including no-shows**, with staff-initiated
exceptions only. No screen may promise money back. Where a member can't verify,
the resolution is either **hold the place and pay nothing yet, settling at the
desk**, or **pay in full and have the desk credit the admissions** toward sticks,
a competition entry, or the next event.

## A volunteer never decides and never refuses

Every judgement call — allowance already spent, a lapsed membership, a household
that can't be found, a guest who insists — routes to a **board member present at
the event**. That hand-off is a first-class navy full-width action, not a buried
link, and the screens say so in as many words: *"This isn't yours to decide —
don't say no and don't improvise a price."*

## Two ticket models — decide before building

The two files use **different, incompatible ticket models**. This is the main open
question for the team.

| | `DCICA Events.dc.html` | `DCICA Member Checkout.dc.html` |
|---|---|---|
| Ticket identity | One QR **per named attendee** | One QR **per party**, anonymous |
| Personal data | Name + email per ticket | Party/family surname only |
| Door read | Scan each person | Scan once, read headcount |
| Scope | 23 screens, full lifecycle | 13 states, checkout + membership |

The **anonymous per-party model in `DCICA Member Checkout.dc.html` is the client's
latest direction** and satisfies the no-personal-detail constraint. Recommendation:
build that model, and port the events/scanner/admin/vendor screens from the other
file onto it. The per-person screens in the events file (ticket wallet, per-person
QR, "1 of 3 in" party progress) assume the older model and need reconciling.

---

## Design tokens

Source of truth: `_ds/modernist-949fda96-bb6e-4e15-b019-48ec42201a5b/styles.css`
(included). Tokens live in `:root`; the pages consume them via `var(--*)`.

### Colour roles

| Token | Hex | Role |
|---|---|---|
| `--color-text` | `#0c3543` | Deep navy. Body copy, primary button fills, dark panels, rules. |
| `--color-accent` | `#f9a200` | Saffron. Accent bars, headers, emphasis, primary CTA on light ground. |
| `--color-accent-2` | `#138808` | India-flag green. **Success and confirmation only.** |
| `--color-bg` | `#f7faf9` | Pale canvas. |
| `--color-surface` | `#f0f4f4` | Inset panels. |
| `--color-divider` | `color-mix(in srgb, #0c3543 38%, transparent)` | Rules. |
| `--color-on-accent` | `#16201f` | **Ink for text on saffron fills. Never white on saffron.** |

These are DCICA's established identity from dcica.org (navy wordmark, saffron nav
bar, flag-green footer band) — members already recognise them. Do not substitute.

### Contrast rules

- **Saffron `#f9a200` is high-luminance.** Text and icons on it use `#16201f`.
  White on saffron fails contrast and is banned.
- Navy `#0c3543` fills take white or `--color-bg` text.
- Flag green `#138808` fills take white text.
- For paragraph-size text in saffron on the pale canvas, use `--color-accent-700`
  (`#a86800`), not the base.
- Focus ring: `outline: 2px solid var(--color-accent); outline-offset: 2px`.

### Tonal ramps

All three roles carry 100–900 ramps on a shared perceptual lightness scale, so the
same step of any role has equal visual weight. Use 100–300 for tinted fills and
hovers, 500 as base, 700–900 for text on tints and pressed states. Prefer ramp
steps over ad-hoc `color-mix()`.

```
neutral   100 #f4f6f7  200 #e4e9eb  300 #cbd4d8  400 #a6b4ba  500 #7f9199
          600 #5e737c  700 #43585f  800 #1d3d48  900 #0c3543
accent    100 #fff7e6  200 #ffe9bd  300 #ffd486  400 #ffbe45  500 #f9a200
          600 #d98a00  700 #a86800  800 #7a4b00  900 #4d3000
accent-2  100 #eaf7e8  200 #c9ebc4  300 #9bd894  400 #57bd4c  500 #138808
          600 #107206  700 #0c5804  800 #084103  900 #052a02
```

### Typography

**IBM Plex Sans** for both headings and body — matches dcica.org, which self-hosts
it via `next/font`. Use the codebase's existing font loading; do not add a second
Google Fonts link.

| Use | Size / weight | Notes |
|---|---|---|
| Screen H1 | 24–34px / 700 | `letter-spacing: -.03em` |
| Big numerals (dates, headcount) | 40–52px / 700 | `letter-spacing: -.04em` |
| Card title | 19px / 700 | `letter-spacing: -.02em` |
| Body | 13–15px / 400 | `line-height: 1.5–1.6` |
| Button label | 15–16px / 700 | |
| Eyebrow / kicker | 9–11px / 700 | `letter-spacing: .12–.18em`, uppercase |
| Metadata | 11–12.5px / 400 | usually `--color-neutral-600` |

Heading weight is `700` (`--font-heading-weight`). Long headings and card titles
carry `text-wrap: pretty`.

### Spacing, radius, elevation

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32px. Screen gutter is **20px**.
- **`border-radius: 0` everywhere.** Zero corner radius is a defining rule of the
  system — do not round anything.
- Rules: **2px** between major sections and around emphasis cards, **1px** between
  list rows, **2.5–3px** for the strongest emphasis (door pass frame).
- Shadows: `--shadow-sm/md/lg`. Used sparingly; the system organises by alignment
  and rules, not elevation. Nothing floats.
- Layout: flush-left throughout — headings, copy, and **button labels** (a button
  wider than its label starts text at the left padding edge, never centred).
- Use flex/grid with `gap`, not margins between siblings.

### Icons

Lucide, 2–2.6px stroke, `currentColor`, 16–26px at interface sizes.

### Imagery — the poster rule

DCICA publishes every event as a **full-colour portrait poster** with title, date,
venue, price, contact and a QR baked into the artwork. It goes out on WhatsApp and
Facebook before it reaches the site. **That artwork is the event announcement.**

- **Never crop it.** Constrain width, let height follow the natural ratio
  (**0.70–0.80 portrait**). Real files: `Dandiya.jpeg` 643×803 (0.80),
  `Diwali_Flyer_2026.jpeg` 643×922 (0.70).
- **Never greyscale or tint it.** Use `.poster { display:block; width:100%; height:auto }`.
- Implementation: `aspect-ratio: 0.80` wrapper with `object-fit: contain`.
- `.grayscale` (`filter: grayscale(1) contrast(1.08)`) remains available for
  **candid event photography only**, never promotional posters.
- The event-detail screen puts the **eyebrow and title above the poster**, so the
  screen retains a readable identity if the artwork fails to load.

---

## File: `DCICA Member Checkout.dc.html` — 13 states

The membership and checkout flow. **This is the model to build.** A left sidebar
navigates the states; a "simulate a dropped network" button applies the offline
banner to any state.

Event context: Rhythm of Navratri, Sat 10 October 2026, McKamy Middle School,
Flower Mound TX.

### Cart — three item kinds

The three line items **must read as visibly different**. This is the single most
important thing in the design.

| Item | Price | Unit | Treatment |
|---|---|---|---|
| Floor admission | $15 | per person | White card, **2px navy border**, navy cap bar with ticket icon: "ISSUES A SCANNABLE TICKET" |
| Dandiya sticks | $5 | per pair | Grey `#f0f4f4` card, **2px dashed `#7f9199` border**, dashed cap: "COLLECT AT THE DOOR · NO TICKET" |
| Dance competition entry | $30 | **per group, any number of dancers** | `#fff7e6` card, **3px `#a86800` border**, `#a86800` cap with an X icon: "NOT A TICKET · NO FLOOR ACCESS" |

Competition entry additionally contains an inset white box, 2px `#a86800` border:

> **Performing does not get your group onto the floor.**
> Anyone who wants to dance after the competition needs their own floor admission
> above. Doors staff cannot let a group in on this entry.

The group fee is flat — six dancers or sixteen, $30. Collect a dancer count for
stage and sound planning only, and say so, or people assume per-head pricing.

**The competition trap.** When `comp > 0 && floor === 0`, a navy panel appears with
a saffron warning icon:

> **Your group can perform, but nobody can stay to dance.**
> You have 1 group entered and no floor admission. Add admission for the dancers who
> are staying, or carry on if they're leaving after the performance.

Plus a one-tap saffron fix: "Add 6 floor admissions · $90". This is not a blocking
modal — a group genuinely may be leaving after performing. It is the design catching
the door argument before it happens, and it should not be softened.

Header: saffron band, dark ink, org name eyebrow / event title / date and venue.
Sticky footer: item summary left, subtotal right (25px/700), navy 56px CTA.

### Membership states

**03 · The prompt.** "Are you a DCICA family member? Members get 4 free admissions."
Three options at equal visual weight — "Yes, I'm a member" (navy fill), "No,
continue as a guest" (2px navy border, **not** a lesser option), "I'm not sure".
An inset note states free admissions never apply to sticks or competition entry.
Closing line offers joining at the desk. **Must not shame non-members or bury members.**

**04 · Email entry.** Single 56px field, `type="email"`, `inputMode="email"`. Note
that the cart survives the lookup.

**05 · Code sent.** Wording is deliberately non-confirming:

> If **arun.patel@gmail.com** is on our membership list, a code is on its way to it now.

Saffron-tinted note: "It may land in Promotions or Spam — Gmail files our emails
there sometimes." A clock row states the code works for **30 minutes**. A
"Nothing arrived?" row leads to state 08.

**Resend affordance:** visible but secondary — bordered, below the navy primary.
**Disabled for 60 seconds** with a live countdown ("Send a new code in 47s"),
`opacity: .6`, `cursor: not-allowed`. A tertiary underlined "Use a different email".

**06 · Code entry.** Six boxes, `aspect-ratio: .78`, 2.5px navy border, 30px/700
digits. Custom 3×4 numeric keypad, 58px cells, plus a backspace key — **phone
keypad, not a text input**. Submit is disabled-styled (`#cbd7d9` fill, `#5e737c`
text, label "Enter all 6 digits") until 6 digits are entered, then navy "Confirm my
membership".

**07 · Wrong code.** Saffron-bordered panel: *"That code didn't match. Try again, or
send a new one. Your cart and your email are still here."* Digit box borders turn
`#a86800`. **Attempts remaining shown only after a failure** — never before.
**Never dumps the cart or clears the email.**

**08 · No code arrived.** Replaces an earlier "email not found" state, which
disclosed roll membership. Neutral: two numbered checks (look in Promotions/Spam;
membership may be under a different or a spouse's address), then a saffron-bordered
reassurance:

> **You're getting in either way.** Pay now and keep your place. Show your pass and
> ID at the welcome desk on the night, and we'll comp your member admissions there
> and refund the difference.

Three actions: resend (respects the 60s lock), "Pay now, validate at the event"
(2px navy border, equal weight — this is the client's preferred resolution), "Try a
different email". Plus a phone number for people who want a human.

**09 · Expired membership.** **Leads with recognition before money:** a grey row
reads "Found you — **Patel family**, member since 2016". Then "Your membership ended
30 June" and "Renew now and your **4 free admissions apply tonight**". Two inline
plans — Family 1 year $60 (recommended, 3px `#a86800` border), Family 3 years $150.
Declining is a full-width bordered button, unpunished: *"Not tonight — carry on
without renewing. Full price this time. Nothing changes at the door."*
A ten-year member may land here; tone must never imply doubt.

### Comp arithmetic (states 10 & 11)

Membership includes **4 free floor admissions**, applied **only** to floor admission
— never to sticks or competition entry.

```
comped     = verified ? min(4, floorQty) : 0
paidFloor  = floorQty - comped
total      = paidFloor*15 + sticksQty*5 + compQty*30
```

Shown as a **ledger, not a rejection**. Header band is deep saffron with a check icon
and "MEMBERSHIP CONFIRMED". Rows:

- `4 free member admissions` — **−$60** — on `#fff7e6`, `#a86800` text,
  sub-label "Included with your family membership"
- `2 additional at $15` — **$30** — sub-label "Beyond your 4 included"
- `2 pairs of sticks at $5` — **$10** — sub-label "Collect at the door · not covered by membership"
- competition entry row when present — sub-label "No floor access · not covered by membership"
- **Total** — 32px/700, above a 2.5px navy rule

Nothing hidden. Rows render conditionally on quantity.

**Full comp / $0 path.** When the total is 0 the order is **still fully itemised**,
the CTA becomes deep-saffron "Get my pass", and **payment is skipped entirely**.
Note reads "Nothing to pay. Your pass is issued straight away."

### 12 · Payment

**Card is delegated to Stripe** — see screen 06 in the events file for the pattern.
Amount due at 34px. **One name field only** — family or last name — labelled "Name
for the door", with "The only name we ask for. Volunteers call it out at the door."
Card details are collected by Stripe, not by this form. Reassurance: *"If your signal drops while paying, we don't charge twice
— come back and the order is waiting here."* Secondary: "Pay at the welcome desk instead".

### 13 · Door pass

**A volunteer in a dark gym with a line behind them must read this in under two
seconds.** Layout order is deliberate:

1. Deep-saffron strip: "YOU'RE IN" + "SAVED OFFLINE"
2. **QR** 210px, 3px navy border, three finder patterns — scan target found instantly
3. Short code `NAV-7K42`, 19px, `letter-spacing: .22em`
4. **The two-second read**, in a 3px navy frame:
   - `PARTY` eyebrow, then **PATEL** at 40px/700
   - split row: `PEOPLE` **6** at 52px/700 | **PAID** block on brightest saffron
     `#f9a200` with `#16201f` ink — highest luminance, most legible in the dark
5. Grey breakdown row: **4** member admissions · **2** paid
6. **Saffron strip: "2 pairs of sticks — hand over at the door"** — a separate strip
   because it is a different action for a different volunteer. Renders only when
   sticks > 0.
7. Event, venue, order id, paid date
8. "This pass works without signal. Screenshot it if you like — the code is the same."

**Critical:** every figure on the pass derives from the same computed values as the
review screen. A guest and a volunteer must never see two different numbers for one
order. On a fully-comped order the block reads **MEMBER / "Nothing due"**, never a
card charge that did not happen.

### State (checkout)

```
screen           current view
floor,sticks,comp    quantities
member           'none' | 'verified' | 'expired'
compAllowance    4
code             string, max 6 digits
codeError        boolean — gates the error panel and attempts line
attempts         integer, shown only after failure
resendIn         seconds, ticks down each second, gates resend
offline          boolean — renders the banner on any screen
```

Everything derived (`comped`, `paidFloor`, `total`, `free`, every display string)
is computed from these — nothing about money is stored twice. Persist the cart and
the email to local storage so a dropped connection or a closed tab loses nothing.

---

## File: `DCICA Events.dc.html` — 23 screens

Full lifecycle on the older per-person ticket model. Use for the scanner, admin and
vendor flows; reconcile the attendee screens to the anonymous model.

### Attendee (01–11)

- **01 Events** — Saffron header. **"Next up" hero on navy takes the whole first
  screen**: 40px date numeral, event title, venue, then the day's **two sessions as
  separate tappable rows** — "4:00 PM · Rhythm of Navratri · Group competition · $30
  per group" (dark grey) and "7:15 PM · Dandiya · floor opens · $30 member / $40 general"
  (saffron). Remaining events compress to 13px date + title rows. Member status strip
  on `#fff7e6`. An 84px portrait poster thumbnail sits in the hero.
- **02 Navratri day** — Eyebrow + title above the poster on navy, then a
  date/venue/doors table, then **two session blocks with separate ticketing**:
  competition (group fee, "Enter a team") and floor (four tiers, "Get floor tickets").
  States that competition covers the 4 PM session only.
- **03 RoN competition entry** — Team name, category (Junior/Senior/Open with slot
  counts), dancer count with an explicit "the $30 entry covers the whole group" note,
  routine length, contact, MP3 upload, stage rules.
- **03 Tickets · three items** — Sells the three items (see below), each priced from
  the event's **configured price set**, not a fixed tier list.
- **05 Who's coming** — One card per ticket: full name, plus an **optional phone or
  email per attendee** so that person's QR is sent directly to them ("We'll text his
  QR straight to him"). Optional is real — a blank contact leaves that QR in the
  buyer's order. A trailing checkbox copies every QR to the buyer as well, so the
  whole party lives in one place. Ticket 1 shows a contact already on file; ticket 3
  (a guest) explains why a separate contact is useful.
- **06 Payment** — **Card is delegated to Stripe, never collected in-app.** A navy-capped
  panel reads "CARD PAYMENT HANDLED BY STRIPE" with: "You'll finish on Stripe's secure
  checkout, then come straight back here for your tickets. Apple Pay and Google Pay
  work there too," plus two ticked assurances — DCICA never sees or stores the card
  number, and a dropped signal mid-payment won't double-charge. **No card, expiry, CVC
  or ZIP fields exist.** CTA is "Continue to Stripe · $X". Cash remains a parallel
  till-gated path with tendered/change.
- **07 Confirmation.**
- **08 My tickets**, **09 Ticket QR** — per-person wallet; **these assume the older
  model.**
- **10 Medical camp slots** — Time slots (Full / 3 left / selected / 12 left) and
  **"Services requested"** as draw-only line items. States *"Results are released by
  the lab directly to you — DCICA never sees them."* **No PHI.**
- **11 Free RSVP** — Headcount stepper (52px), dish and volunteer checkboxes.

### Door volunteer (12–17)

- **12 Scanner** — Dark `#0c3543`. **Session toggle** (RoN 4 PM / Floor 7:15 PM) —
  the scanner must know which session it is admitting. Live count, progress bar,
  250px reticle with saffron corners, 56px "simulate a valid scan", and a
  "look up by name instead" fallback.
- **13 Valid scan** — Flag-green `#138808` full screen, white text. Name at 34px.
  Then **the party signal, the loudest element after the name**: white block,
  `THIS PARTY`, **1** at 46px against "of 3 in", **"2 still to scan"** at 17px in
  `#a86800`, and the instruction *"Each person has their own code. Don't wave the rest
  of the group through on this one."* This is what stops a whole party entering on one
  ticket. Actions: "Next person" (white, 56px) and **"Undo this scan"** (2px white border).
- **14 No floor ticket** — A competition QR at the floor door. **A genuine refusal,
  not a wave-through:** "Group competition entry does not include the open floor. Sell
  them a floor ticket here, or send them to the box office." Primary action is
  **"Sell floor ticket · $40"**.
- **15 Undo a scan** — Confirmation stating the consequence: *"Their code becomes valid
  again and the door count drops by one. Use this for a double scan or the wrong
  person's phone."* **Undo window: 2 minutes**, then a lead must correct it.
- **16 Door status** — Per-session and per-door counts with throughput (12/min),
  and a **last-scans log where every row carries a 48px undo button**, headed
  "Undo within 2 min". This is where a mis-scan is actually noticed.
- **17 Sell at the door** — *Not yet built.* Intended: tier steppers, then card
  delegated to Stripe Terminal or a Stripe-hosted link, with cash to the till as a
  parallel path.

### Admin (18–19)

- **18 Live dashboard** — Gross on navy with a year-over-year delta, a 2×2 metric
  grid (floor sold / RoN teams / checked in / booths), a horizontal bar chart of
  sales by tier, CSV export.
- **19 Event setup** — Event name, **sessions list** (each with its own open/closed
  state), floor tier price fields, and toggles for "member discount applies
  automatically" and "one QR per named attendee".

### Vendor: booth application and Zelle payment (20–23)

**Zelle is the required path.** It costs the association nothing and settles same-day,
so the whole fee reaches the event. Card is deliberately demoted.

- **20 Booth application** — Business name, booth type (Food 10×10 $450 / Retail
  10×10 $300 / Community table free), contact, phone, health-permit upload, load-in
  window. CTA: "Apply and pay by Zelle".
- **21 Zelle request sent** — Rebuilt around a **DCICA-initiated Zelle request**,
  because the earlier design showed a QR on the very phone the vendor was holding —
  unscannable. The treasurer's side pushes a request; the vendor approves it in their
  own bank app with amount and reference already filled in, which removes the
  copy-paste and the forgotten memo entirely. Screen shows: request-sent confirmation
  with the destination, the amount/reference/requested-by triplet to check, and the
  **verify-the-name warning** (still the main defence against a spoofed address).
  Then **resend** and **send to a different number** — the Zelle-enrolled phone is
  often not the contact phone, so capture it on the application screen.
  A clearly secondary "Or send it yourself" panel keeps the manual path:
  - **Send to** — the Zelle address, with a 48px copy button
  - **Recipient name** — plus *"Your bank should show this before you confirm. If it
    shows anything else, stop and call us."* **This is the main defence against a
    spoofed address — keep it.**
  - **Amount** $450.00, with copy
  - **Memo reference `BOOTH-0142`** at 22px in a 2px saffron box: *"Without it we
    can't tell your payment from anyone else's, and your booth stays unassigned."*
  - A live "copied" confirmation line
  - A numbered three-step summary
  - **Card demoted** to a thin bordered secondary showing its true cost: "Adds 3%
    processing · $463.50 total". Cheque by post mentioned in fine print.
  - **Zelle credentials must be injected at runtime, never hardcoded.** In the
    prototype they are props (`zelleHandle`, `zelleName`).
  - **Text these details to my phone** — because the vendor will be inside their bank
    app when they need the reference, not on this page. The clipboard holds one item,
    so copying the address loses the memo; the text survives the app switch.
  - The **QR is collapsed behind "Paying from a computer?"** and labelled for the
    second-device case, which is the only case where it works.
  - Card is offered as a demoted fallback showing its true cost (+3%).
  - The same screen serves **RoN group entries** (`zelleFor`), with the reference,
    amount and back-target switching — one Zelle pattern, two entry points.
- **22 Enter transaction code** — The vendor returns after paying and supplies the
  reconciliation key: **transaction code** (58px field, 19px/700, `autoCapitalize`,
  "usually 8–12 letters and numbers"), date sent, amount sent, sending bank, optional
  confirmation screenshot. Warning: *"Wrong code is worse than none — a code that
  doesn't match sends your booth back to the pending pile."*
- **23 Awaiting payment match** — Saffron header, "Booth reserved · payment pending",
  *"Our treasurer checks Zelle activity each morning... usually within one business
  day."* Echoes back what they submitted, then a four-step tracker: application
  received ✓ / code submitted ✓ / **treasurer matches payment (in progress)** /
  booth number assigned — the last step labelled **"Booths are only assigned once
  payment clears"**, matching DCICA's existing published policy. Includes "correct my
  transaction code" and the booth desk phone number.

### Cash at the door

Card/cash toggle, quick-tender buttons ($100 / $120 / $150 / Exact), then a
**large change-due readout** — 30px+, flag-green fill when change is due, **saffron
with dark ink when the tender is short**, reading "Short $12". Footnote: "Cash goes
in the till. Give $25 change." / "Counts against Door 2's till. Reconciled at
close-out." **Cash is hidden entirely from volunteers without a till** —
permission-gated, exposed in the prototype as `volunteerHasTill`.

---

---

## File: `DCICA Operations.dc.html` — 13 screens

Operations and coordinator surfaces. Phone-first like everything else — a
coordinator works these standing in a hall, not at a desk.

### Membership roster (01–03)

**Scoped to an event, chosen at the top**, because every row must answer *has this
household bought for this event yet?*

Row: household name, a tag (**Current** / **Lifetime** / **No expiry set**), contact,
the order line, and the allowance as a numeral with "n used" beneath.

Filter chips, each a real working query: **All 214**, **No order found 19**,
**Paid full, allowance left 7**, **Checked in 96**. The middle two are the ones a
coordinator works the phones from the week before, and each carries a note
explaining why it matters — *"These paid full price with free admissions still
available. Worth a call before the event — they are the ones who feel
short-changed afterwards."*

**Order-matching caveat, designed around explicitly.** Households match orders by
email, so a member who checked out under another address shows as unmatched. The
copy is always **"No order found under this email"** — never "hasn't bought". A
footer states the caveat, and **02 Household detail** offers **03 Link an order by
hand**: search tonight's orders by name, phone or code, see candidate matches with
why each matched ("Phone matches this household" vs "Name only · different
phone"), and link. Linking is reversible and logged.

**Two real roster states** designed rather than idealised: a household with **no
email on file** (joined before we collected one — can't use the online code check)
and one whose **expiry was never recorded** (*"Treat as current and ask the
membership chair to set one — don't turn them away over a missing field."*).
**Lifetime members read as "Lifetime", never as a date.**

### Volunteer module (04–07)

- **04 Sign up** (public) — role cards with capacity bars ("4 of 6 filled", a full
  role dimmed and unclickable), shift picker, name, mobile, and a student
  "needs hours recorded" checkbox. States what the phone number is for and that
  it's used for nothing else.
- **05 Coordinator roster** — signed up / on site / not arrived as three numerals,
  then per-shift lists. A late volunteer's row is tinted saffron with *"40 minutes
  late · texted, no reply"* and a **Call** action. Bulk text and hours export.
- **06 Check in and out** — dark screen for outdoor use. The volunteer's own clock
  runs large (**1:48 so far**) above a 64px **Check out now**. Below it, a scanner
  and name lookup for checking others in. States that a coordinator can close a
  forgotten shift later, and that hours lock when the event closes.
- **07 Hours and certificate** — thanks by name, hours tonight and for the school
  year, then a signed certificate download for NHS/community-service credit.

### 08 Event lifecycle (coordinator)

Draft → open for registration → **live** → closed, shown as a progress list with
the current state tinted. Plus a **walk-in sales toggle** that opens day-of selling.

**Every transition states its consequence before it is tapped** — closing the event
lists, as four separate lines: scanning stops, walk-in sales end and tills freeze
for counting, volunteer hours lock, and the event leaves the public list. A saffron
warning names the live obstacle: *"3 volunteers are still on the clock — close
their shifts from the roster or their hours will be cut off at this moment."*
Only a coordinator can change state; changes are logged with a name and time.

### 09 Close-out and reconciliation (treasurer)

Gross on navy, then **by payment method** (Stripe online, Stripe door readers, cash
across tills, Zelle booths with one outstanding). Then **cash counted against
expected, per till**, with the variance row and the short till tinted saffron
(*"Ravi K · short $20"*, variance **−$20**) and guidance on what to escalate.
Then the non-cash figures that still need recording: **comped admissions as revenue
foregone**, competition fees, and **sticks sold vs handed over** (61 sold, 58 handed
over, 3 unclaimed). Export for the treasurer; signing off locks the event.

### 10–11 Transactional emails

Both render in a phone inbox frame with a working **As designed / Plain-text
fallback** toggle, because a real plain-text alternative has to be authored, not
generated.

- **10 Order confirmation** carries the pass: QR, code, headcount, PAID block, the
  member/paid split, sticks to collect, venue and times, and the no-refunds line.
- **11 One-time code** keeps the **non-confirming wording** — *"If this address is on
  our membership list, this code will confirm it"* — because the system must never
  reveal who is on the roll. It also handles the unrequested-email case
  (*"Ignore the email and nothing happens — no account exists to access"*) and the
  two-codes-arrived case (newest wins).

### 12–13 Public list states

- **12 Empty** — *"Nothing on the calendar just yet"*, with the seasonal rhythm
  stated (Diwali early November, Holi in March, registration ~6 weeks ahead), a
  notify-me action, and routes to past events, membership and volunteering. Never a
  bare empty box.
- **13 Past** — next-up still leads; the just-finished event sits in a dimmed card
  with attendance and thanks, plus **See photos** and **Competition results**. Older
  events compress to one-line rows. States that a finished event stays for a season
  then archives, and that **past tickets no longer scan**.

---

## Interactions & behaviour

- **Navigation** is screen-to-screen with an explicit 48px back button top-left.
  No gesture-only navigation.
- **Hover:** `--color-neutral-200` tint on bordered/ghost controls;
  `--color-accent-600` on saffron fills; `#164d5f` on navy fills.
- **Active/pressed:** one ramp step further (`--color-accent-700`, `#0a2c37`).
- **Focus:** 2px saffron ring, 2px offset. Never the browser default.
- **Disabled:** 45% opacity, or the explicit `#cbd7d9`/`#5e737c` treatment on the
  code-submit button.
- **Progress:** three or four equal saffron/grey segments, 4px tall, plus a
  "Step n of m" label in the header.
- **No decorative animation.** The system is flat and static by intent; the only
  motion is the resend countdown and copy-confirmation text.
- **Offline:** a saffron banner with a wifi-off icon appears under the status bar on
  any screen: *"No connection right now — your cart is saved on this phone. Nothing
  is lost, we'll pick up here when you're back."*

## Payments

Three distinct paths, deliberately different:

| Path | Where | Handling |
|---|---|---|
| **Floor / attendee tickets** | Attendee checkout | **Delegated to Stripe Checkout.** The app collects no card data. Return the user to the confirmation screen on success; treat a dropped connection as resumable, never as a second charge. |
| **Cash at the door** | Volunteer, till-gated | In-app. Tendered + change due in large type. Hidden from volunteers without a till. |
| **Vendor booths** | Vendor | **Zelle-first**, reconciled by transaction code (screens 21–23). Card offered only as a demoted fallback at +3%. |

Do not unify these behind one payment component — the trust model differs in each.
Stripe owns card data; Zelle is a manual bank push needing human reconciliation;
cash needs till attribution and close-out.

## Checked against the client's codebase (dcica/medcamp)

The design was reviewed against the real repo after the first handoff. Four findings
that constrain implementation:

**1. `PaymentMethod` already carries `ZELLE` and `CHECK`.** The designed rails fit
`prisma/schema.prisma` as-is — `Payment` has Stripe ids, `cashTenderedCents`,
`cashChangeCents` and `recordedByUserId`, and `LedgerEntry` drives the
reconciliation export the close-out screen shows.

**2. There is no field for a Zelle reference. Add one.** Nothing on `Payment` stores
the transaction code the vendor supplies, nor who matched it. The booth flow needs
something like `externalRef` + `matchedByUserId` + `matchedAt`, or it cannot be
reconciled at all.

**3. Zelle can never auto-confirm — the pending state is structural, not cosmetic.**
`src/server/payments.ts` is explicit that the Stripe webhook is authoritative for
`SUCCEEDED`; there is no Zelle equivalent. A Zelle order stays `PENDING` until a
human marks it. The "Awaiting payment match" screen is therefore a required state,
not a nicety, and **no Zelle variant removes the manual matching step** — the
request-based flow removes the *forgotten-reference* failure, which is a different
problem.

**4. Payment Override already exists — the board hand-off must resolve into it.**
`docs/Payment-Gateway.md` §5 defines override with mandatory reason codes
(financial hardship / volunteer or staff / committee decision / complimentary /
other-with-note), an audit trail against the volunteer id and timestamp, an
override log on the coordinator dashboard, and a section in the close-out export.
Critically, **override authority is a separate role flag from till access**. The
door-comp screens were reworked to route into this rather than inventing a parallel
waiver: the volunteer's screen says only someone with override authority can waive
and it needs a recorded reason, and the board-member screen shows the five reason
codes as the panel that person completes on their own phone. **Do not build a second
waiver path.**

### One divergence to resolve

`docs/Payment-Gateway.md`'s payment matrix lists Zelle for **vendor registration**
and **sponsorship** only; day-of event tickets are Stripe Tap to Pay + cash. The
client later directed that **RoN competition entry** also go by Zelle. That is a
change to the documented matrix and the doc should be updated — or the decision
revisited, since competition entry is a fixed $30 with no capacity race, so Stripe
would confirm it instantly for roughly $1 in fees and remove a manual match. The
prototype implements the client's instruction; the trade-off is flagged.

Also: `src/app/vendors/page.tsx` today only captures intent and states that vendor
payments are handled offline — so the entire booth flow is new work.

## Assets

- **No image assets are included.** Poster placeholders are drop-target components
  in the prototype. Source the real artwork from dcica.org's media library
  (`Dandiya.jpeg` 643×803, `Diwali_Flyer_2026.jpeg` 643×922) or from the DCICA
  committee. Render at natural ratio, full colour, uncropped.
- **Icons:** Lucide, drawn inline as SVG in the prototypes. Use the codebase's icon
  library.
- **QR codes** are CSS `repeating-conic-gradient` stand-ins with hand-drawn finder
  patterns — **placeholders**. Generate real codes server-side.
- **Font:** IBM Plex Sans. dcica.org already self-hosts it via `next/font`; reuse that.

## Files in this bundle

| File | What it is |
|---|---|
| `DCICA Member Checkout.dc.html` | 13-state membership + checkout flow. **The model to build.** |
| `DCICA Events.dc.html` | 21-screen event app: events, tickets, Stripe checkout, scanner + undo, door comp, board hand-off, admin, vendor/Zelle. |
| `DCICA Operations.dc.html` | 13-screen operations set: membership roster, volunteer module, lifecycle, close-out, transactional emails, empty/past states. |
| `styles.css` | Design-system tokens and component classes — the source of truth for colour, type and spacing. |
| `design-system-readme.md` | The Modernist system's own guide, retuned to DCICA (palette, type, imagery rules, do/don't). |
| `image-slot.js` | The drop-target placeholder used for posters. Reference only. |

Open either `.dc.html` in a browser to view the designs.

## Known gaps

1. **Ticket model unreconciled** between the two files — decide before building.
2. **Screen 17 "Sell at the door" is not built.** Rail entry exists; intended design
   is described above.
3. **All prices, capacities, dates and renewal amounts are placeholders**, confirmed
   as such by the client. Get real figures before launch. One pricing fact is **not**
   a placeholder: the competition fee is **flat per group regardless of dancer count**.
4. **Venue differs between files** — the events file says Lewisville Grand Theater,
   the checkout says McKamy Middle School (the newer brief). Use McKamy.
5. **Client-side prototype only** — no API contracts, auth, or persistence layer.
6. **The medical camp is deliberately absent.** Camp screens, camp events and
   camp-only fields were stripped at the client's request — not deferred, removed.
   The no-personal-data discipline is a **platform rule, not a camp rule**: tickets
   stay anonymous and quantity-based, and the only name collected anywhere is the
   family name for the door.
7. **Also removed as contradicting the anonymous model:** performer signup (the
   competition is a paid line item, roster handled off-system), per-attendee contact
   collection, the per-person QR wallet, and free RSVP.
6. **Not read during design:** the client's existing `medcamp` codebase and their
   Bitbucket repo were not accessible in the design session. **Check the design
   against what already exists** — per the client, these already ship: events list,
   register + Stripe checkout, volunteer signup, vendor interest, check-in/QR scan,
   gate, station queue, badge print, and admin (camps, services, members,
   membership). These are prototype-only: ticket tiers, member auto-pricing, ticket
   wallet, scarcity messaging, performer signup, booth application, door-status
   dashboard.

## Already built in the client's codebase

Design to fit these rather than proposing alternatives. Per the client, all of the
following already ship: the **public events list**, **registration with
Stripe-hosted checkout**, **QR check-in and the door scanner**, **walk-up selling
with cash**, **badge printing**, and **admin for events, services, members and
membership**. IBM Plex Sans is already self-hosted via `next/font`; the
navy/saffron/green tokens are already in the stylesheet; posters already render
uncropped at their natural portrait ratio.

Prototype-only, and therefore new work: ticket tiers and the three-price resolution,
member auto-pricing and the allowance arithmetic, the anonymous party pass, the
scanner undo, member comp at the door and the board hand-off, the door-status
dashboard, the Zelle booth flow, the membership roster's event scoping and
order-linking, event lifecycle controls, and close-out.

## Suggested v1 scope

Load-bearing: the three-price resolution, member auto-pricing and the allowance
arithmetic, the anonymous party pass, the scanner with undo, the board hand-off on
the door-comp path, the Stripe checkout handoff, and the Zelle booth flow.
Close-out matters the first night money is taken. Deferrable: scarcity messaging ("142 left / price rises"), performer
signup, the door-status dashboard, and the admin bar charts.
