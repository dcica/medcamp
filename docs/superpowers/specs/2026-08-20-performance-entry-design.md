# Performance Entry — design

Status: proposed
Date: 2026-08-20
Replaces: two Google Forms (Rhythms of Navratri 2026, Diwali Dhamaka Performance Entry)

## Problem

Dance-group entries for two events are collected on Google Forms today. Both
forms are the same form: group name, choreographer, contact number, group size,
age range, song title, song file. RoN adds duration and a "category"; Diwali
adds props and stage-prep questions.

What is wrong with them, in the order it costs money:

1. **Neither form takes payment.** Diwali asks the group to self-certify
   ("Registration Fee $50 click link to pay → Paid"). RoN's "Performance
   Category" has one option and records nothing. Entries and payment evidence
   are two piles, reconciled by hand.
2. **The RoN form contradicts our own pricing.** It quotes a flat $30. The
   committee sheet and the seeded `competition-entry` offering say $25 early
   bird through Sep 1, $30 online after, $35 at the door. Every group entering
   before Sep 1 is being overquoted.
3. **Google sign-in is mandatory**, because Google Forms forces it on any form
   with a file-upload question. Anonymous visitors are redirected to
   `accounts.google.com`; the form also records the submitter's Google name,
   email and photo. Anyone without a Google account cannot enter.
4. **The stated rules are not enforced.** RoN says 3–10 participants and 5–6
   minutes; Diwali says 3–12. All of it is free text. Diwali leaves "Other:"
   enabled on every choice question, so `Age Group` will return "Mixed",
   "mixed ages", "10 to 40", "all".
5. **No capacity.** RoN's platform cap is 40 groups; the form takes the 41st.
   The Diwali showcase has a fixed runtime and no stop valve at all.
6. **RoN has an unfinished required question** — unlabeled, single option
   "Option 1" (Google's placeholder). Everyone must answer it; it records
   nothing.

## Goals

Take the entry and the fee in one transaction, enforce the caps and the group
rules at the field, and confirm nothing until the money lands.

## Non-goals

- **No form builder.** The two forms' union is about a dozen fields and is
  stable. A generic question engine — types, conditional logic, a response
  viewer, export — would be a large subsystem that competes with Google Forms
  on its own ground and delivers none of items 1–6 above, because generic
  answers cannot be priced, capped, or validated. If a third event needs a
  thirteenth question, add a column; that is a small migration and an honest
  one.
- **No transcoding, and no format support beyond MP3.** One accepted format,
  with an explicit offline path for everything else. See "The song".
- **Vendor and sponsor payments** stay on Zelle/check, per the platform
  mandate. Unchanged by this work.

## Model

### Diwali splits into two events

The showcase becomes its own `Event`, sibling to the festival — exactly the
pattern `RON-2026` and `DANDIYA-2026` already follow, whose seed comment records
why:

> The SAME NIGHT and the same venue as RON-2026, deliberately two events rather
> than one. They are different things sold to different people [...] One event
> could not carry both a membership comp and a competition fee sensibly, which
> is exactly the mess RON-2026 was in before it was split.

So:

- `DIW-2026` (**DCICA Festival of Lights**) is untouched — free entry,
  `offersRegistration: false`, no services. The public card keeps its
  "free entry and free parking" copy and grows no Register button.
- `DHAMAKA-2026` (**Diwali Dhamaka**) is new: same day, same venue (Gerault
  Park), `type: GENERAL`, `collectsAttendeeDetails: false`,
  `honorsMembership: false`, `allowsRefunds: false`, one fee-kind service at
  $50, capacity = performance slots.

This is why no new `offers*` flag is needed: the free festival and the paid
showcase are separate rows, so neither has to represent both audiences.

`RON-2026` needs no structural change. Its `competition-entry` offering is
already the right service kind (`admits: false, fulfillable: false`), already
priced three ways, already capped at 40 groups.

### One group per checkout

`createQuantityOrder` mints one receipt attendee for a fee-only order
(`ticketCount = admissionUnits > 0 ? admissionUnits : 1`), and RoN's line
quantity is documented as *a count of groups*. Three groups in one checkout
would therefore produce one code and one line with nowhere to put three sets of
group details.

Rather than repeat a nine-field group block on a 6" phone, **an entry-bearing
service is quantity-locked to 1**. A choreographer entering three groups checks
out three times. Group names, songs and sizes differ per group anyway, so this
is also the cleaner data.

### `PerformanceEntry`

One row per group, hanging off the order. Contact details are not duplicated —
`Order.registrantName/Email/Phone` already hold them.

```prisma
model PerformanceEntry {
  id      String @id @default(cuid())
  orgId   String
  eventId String
  orderId String @unique          // 1:1 — entry-bearing services are qty-locked
  lineItemId String?              // the fee line this entry paid for

  groupName          String
  choreographerName  String
  participantCount   Int
  ageRange           String       // constrained choice, no "Other:"

  songTitle String
  /// How the track arrives. Explicit rather than inferred from whether
  /// songObjectPath is null — OFFLINE is a real state a coordinator must act
  /// on, not an absence.
  songDelivery   SongDelivery
  /// Storage object path, set ONLY after the server has verified the object
  /// exists and is within the size limit. Null for OFFLINE.
  songObjectPath String?
  /// Set by a coordinator once a playable copy is in hand. Gates the running
  /// order — an uploaded file is not yet a prepared cut. See "The song".
  songReadyAt    DateTime?

  // Event-specific; each event's config decides which are shown.
  durationSeconds Int?
  usesProps       Boolean?
  needsStagePrep  Boolean?
  category        String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Not PHI: a performance entry is not a patient record, so the No-PHI constraint
is not engaged. These rows are **not** camp-scoped and are not purged with
attendee PII — the running order and the results are the event's record.

### Per-event rules live on `ServiceCap`

RoN allows 3–10 participants and 5–6 minutes; Diwali allows 3–12. These are
per-event, like price and capacity, so they belong beside them as typed columns
rather than in a Json blob:

```prisma
minParticipants   Int?
maxParticipants   Int?
minDurationSeconds Int?
maxDurationSeconds Int?
```

Validated on the client for feedback and re-validated server-side, which is
where the current forms have nothing at all.

## Payment

No new payment path. The entry rides the existing contract:

- Submit creates a `PENDING` order plus the `PerformanceEntry`, then redirects
  to hosted Stripe Checkout (`createCheckoutForOrder`).
- The Stripe webhook calls `confirmOrder`, which does the atomic cap increment
  (`sold <= capacity - qty`), assigns the receipt code, and flips line items to
  `PAID` — all in one transaction.
- **An unpaid entry is a `PENDING` order and is invisible downstream.** No slot
  held, no running-order position, no coordinator roster row. This is the
  behaviour `Attendee.campId` already documents: "assigned at payment
  confirmation, not at cart creation."

One inherited nuance, not worth solving: because `sold` increments on the
webhook, abandoned carts correctly do not burn slots, but the cap can oversell
if enough groups are mid-checkout simultaneously. Over a multi-week window for
40 groups this is theoretical, and `payments.ts` already documents accepting the
tradeoff.

## The song

**MP3 upload, max 10 MiB, or an explicit offline arrangement.** Two states, no
third:

```prisma
enum SongDelivery {
  UPLOAD  // MP3 in storage
  OFFLINE // entrant will arrange with the organizers; needs coordinator follow-up
}
```

`OFFLINE` deliberately replaces the shared-link field an earlier draft had. A
link was only ever a partial answer — someone still has to fetch and prepare the
track — and "I'll arrange it with the organizers" covers the link case (they can
email one) while creating a *visible work item* instead of the appearance of a
solved problem. It is also the landing place for anyone whose file is the wrong
format or too large, so no entrant hits a dead end.

### The browser uploads straight to storage

The file never passes through a serverless function. A server action authorizes
the entry and mints a **single-use signed upload URL scoped to one object
path**; the browser PUTs directly to storage and then reports completion.

This sidesteps the platform's request-body limit entirely rather than betting on
what it currently is, and 10 MiB never occupies function memory or billed time.

**Completion is verified, not trusted.** A client can claim success without
uploading anything, so on the completion call the server asks storage whether
the object exists and what it weighs, and only then writes `songObjectPath`.
Without that check `songReadyAt` would ultimately be gating on a client's word.

Object path: `{orgId}/{eventId}/{entryId}/{token}.mp3` — org first so a storage
policy can key on it, random token so the object name does not leak the group.

### The size limit is enforced in three places

10 MiB (10,485,760 bytes). Two of the three are UX; only one is enforcement:

1. **Client, before requesting a URL** — check `file.size` and refuse
   immediately, so a 40 MB file is not uploaded before being rejected. Steer the
   entrant to `OFFLINE` rather than leaving them stuck.
2. **Bucket `file_size_limit`** — the actual gate. The browser talks to storage
   directly, so a crafted client skips step 1 entirely; this is the only layer
   that cannot be bypassed.
3. **Server verification on completion** — an object over the limit is rejected
   and deleted rather than recorded.

### Type checking, and why the bucket must be private

Because we are not in the byte path, our code cannot inspect the file. The
bucket's `allowed_mime_types` does the filtering, and it checks the **declared**
Content-Type, not the bytes — so a mislabeled file can land.

That is tolerable here only because the object is downloaded and played by a
human: never executed, never rendered. It is also precisely why **the bucket is
private and downloads are signed with `Content-Disposition: attachment`**. A
public bucket serving an uploaded HTML file from our own domain would be stored
XSS.

### Upload is post-payment, authorized by the receipt code

There is no login in this flow. Upload happens after `confirmOrder`, and the
receipt `campId` is already an unguessable CSPRNG token (40 bits, Crockford
base32 — see `src/lib/publicId.ts`) built for exactly this kind of lookup.

So `/perform/{campId}` is a capability URL: emailed on confirmation, resolving
to exactly one paid entry, not enumerable. A choreographer returns three weeks
later from any device with no account. Because it is a public bearer token, the
route needs rate limiting.

A consequence worth stating: uploads only exist for paid entries, so there are
no orphan objects from abandoned checkouts. The only orphans are replaced files,
deleted on replace.

### An uploaded file still is not a running order

`songReadyAt` remains a coordinator action. The show needs the trimmed 5–6
minute cut prepared on the tech's laptop; a correct MP3 in a bucket is the
input to that step, not the step itself. Duration also stays unenforceable from
the file — the 5–6 minute rule rests on the declared `durationSeconds`.

### Storage is a provider seam

`src/lib/email.ts` sets the precedent — pluggable provider, and *"when no
provider is configured the message is logged to the console so local dev and
self-host work out of the box."* `src/lib/storage.ts` follows it: a Supabase
Storage adapter, plus a local-disk adapter for development.

The local adapter is not ceremony. Production runs Postgres on Supabase, but
**local dev is Docker Postgres with no Supabase project at all**, and none of
the three `SUPABASE_*` keys are currently set in any env file — the app has only
ever used `DATABASE_URL`. Without the seam, uploads would be untestable locally
and unusable for a self-hoster running plain Postgres, which the AGPL
self-hosting mandate requires. It is also why Vercel Blob is not the primary
adapter: fewer env vars, but a self-hoster can never use it.

### Retention

Objects are deleted when the event reaches `PURGED`; the `PerformanceEntry` row
survives as the event's record. Song files are not PII, but they are storage
cost, and "delete after the show" is the natural policy.

This matters more than it looks: 40 groups × 10 MiB ≈ 400 MiB for RoN, and both
events together approach 800 MiB against a Supabase free tier of (believed)
1 GB — confirm in the dashboard. Without per-event cleanup this runs out within
two seasons.

## Surfaces

- **Public** — `/events/[event]/perform` (or `/register` in an entry mode):
  contact, group, song link, the per-event extras, then Checkout. Phone-first:
  single column, 48px targets, no repeating fieldsets.
- **Confirmation** — the existing `/confirm/[orderId]` page and email, extended
  with the group's details, the fee paid, and the "make your link public"
  instruction.
- **Coordinator roster** — entries for an event, sorted with missing songs
  first: group, choreographer, size, age range, duration, song link,
  `songReadyAt` toggle, payment status. Modelled on `RosterView`.
- **Running order** — ordering over the paid, song-ready entries. Out of scope
  for the first cut; the roster's sort is enough for the first event.

## Open / provisional

- **`DHAMAKA-2026` slot count and show times** — seeded provisional with a
  comment, per the convention RoN's 40-group cap and Dandiya's times already
  follow; a coordinator sets the real figures in the admin UI.
- **Age-range vocabulary** — Diwali's form offers 7–11 / 12–17 / 17+ / Mixed
  (note the overlap at 17). Needs one canonical list per event, without "Other:".
- **`category`** — RoN's form has a "Performance Category" question with a
  single option, so its intended values are unknown. Confirm with the committee
  or drop the field.
- Whether any entries already paid by Zelle need backfilling as
  `PaymentMethod.ZELLE`. Square is retired and needs no representation.
- **Storage is not provisioned.** Needs a private bucket
  (`allowed_mime_types: audio/mpeg`, `file_size_limit: 10485760`), the three
  `SUPABASE_*` keys added to the **prod** Vercel project only, and a separate
  bucket per environment given the 3-project/2-Supabase layout. Keys must come
  from the Supabase dashboard.
- **Free-tier storage headroom** — confirm the current limit against the
  ~800 MiB two-event estimate in "Retention".

## Sequencing

RoN is Oct 10 and its early bird closes **Sep 1**, so the pricing defect (item
2) is the urgent one and is independent of everything above: pointing that
form's fee question at the platform's existing checkout fixes it without any of
this shipping.

Then, in order: the `PerformanceEntry` model and public entry flow (RoN first,
since its event and offering already exist) → `DHAMAKA-2026` seed →
coordinator roster → running order.
