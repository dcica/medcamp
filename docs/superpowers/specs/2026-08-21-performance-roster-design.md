# Performance roster — design

Status: proposed
Date: 2026-08-21
Depends on: `2026-08-21-backoffice-foundations-design.md` (event selection, progress function)

## Problem

The team running the performance night asked to see how many entries there are, whether
any are missing songs, the per-group details, and summaries.

`/admin/performances` exists and covers part of that: entry count, dancer count, a
music-outstanding count, and per-group cards with choreographer, size, age band, song,
declared length, props, stage setup, contact, a three-way music state, a "Mark track
ready" toggle and an MP3 download. It measures clean on a phone (899px, zero undersized
tap targets).

What it cannot answer is everything about *the show*. Computed against live RoN data:

```
ENTRIES            2 of 40 slots  (38 left)
DANCERS            12
REVENUE            $50.00
MUSIC missing      2   — of which OFFLINE 2 (need a human to chase)
MUSIC confirmed    0
RUNTIME declared   5m 30s across 1 entries
  + changeover@1m  7m total show estimate
  duration MISSING 1 entries gave no length
AGE BANDS          17+ years=1   7–11 years=1
PROPS              true=1  null=1
STAGE SETUP        true=1  null=1
```

Three things stand out.

**Total runtime is the number the show runs on, and it is currently uncomputable.**
`durationSeconds` is optional, and one of two entries gave none. At forty groups that is
a show planned on half the data.

**The entry count has no denominator.** "2" is not actionable; "2 of 40, 38 left" is.

**"Music missing" conflates two different jobs.** An OFFLINE entry needs a phone call; an
UPLOAD entry that has not arrived needs a reminder email. Both of RoN's are OFFLINE, so
today's single number hides that this is two phone calls, not two reminders.

### A defect in the existing page

The event picker sorts `startsAt: desc`, so the page defaults to the **2027 test fixture
with zero groups** while RoN — the event holding the actual entries — sits last. This is
the same newest-first mistake catalogued on `/admin/camps` in the foundations spec, in
code written the same day. It is listed here rather than there because the fix is local.

## Goals

Answer, on a phone, in one screen: does the show fit, who is missing music, and who do I
call.

## Non-goals

- **Running order / scheduling.** It is where this leads, and it needs judging
  categories and interval placement to be settled first. The roster's sort is enough for
  the first event.
- Judging, scoring, results.

---

## 1. Duration becomes required

`durationSeconds` moves from optional to required on new entries. The entry form already
knows the event's bound (RoN: 300–360s) and already validates against it, so there is a
value to check and a message to show; making it optional bought nothing and cost the
runtime calculation.

Existing rows with `null` are tolerated (two live entries have one) and reported
explicitly — see the runtime summary below. The migration does not backfill a guess.

## 2. Summaries

A summary block above the roster, and the same figures exposed to
`getEventProgress` (foundations spec) so the event card can show "entries 2/40".

| Summary | Why the show team needs it |
|---|---|
| Entries **n of capacity**, slots left | Whether to keep selling |
| Dancers | Backstage and green-room capacity |
| **Runtime declared**, + changeover budget, = show estimate | Whether the show fits its slot |
| **Entries with no declared length** | The runtime number is only as good as this |
| Music: confirmed / file received / **offline (chase)** / not sent (remind) | Splits the work into the two actions it actually is |
| Age bands | Grouping and judging categories |
| Props / stage setup, **including unanswered** | Drives the changeover budget |
| Revenue | Reconciliation |

**Unanswered is its own count, not folded into "No".** The entry form's props and
stage-setup questions are deliberately three-state, so "didn't answer" is distinct from
"No". For data honesty that is right; for show planning an unanswered stage-setup is a
risk, not a blank, and must be visible as one.

**Changeover budget** is a per-event number (default 60s) rather than a constant — a
showcase with props needs longer than a dance class. It belongs beside the other
per-event competition rules on `ServiceCap`, next to min/max participants and duration.

## 3. Missing music becomes a filter

With forty groups nobody scrolls to find the gaps. Filter chips above the roster:
**All · Needs chasing (offline) · Not sent yet · Received, unchecked · Confirmed**.

Chips over a dropdown: each is a one-tap destination showing its count, so the roster
doubles as the work queue, and on a phone a chip row is a bigger target than a select.

The counts on the chips are the summary numbers, so there is one source of truth.

## 4. Contacting the groups

Chasing music is the roster's main job between entry and show night.

- Each card already has tap-to-call and tap-to-mail. Keep.
- Add a **"Copy emails"** action scoped to the current filter, so "everyone who still
  owes me a track" is one tap into a mail client. Deliberately not a built-in bulk
  sender: this is a handful of people, a coordinator wants to write the note themselves,
  and a send feature would need templates, logging and an unsubscribe path.

## 5. Export

A CSV for the sound desk and the MC — the two people who need this list off a screen.
Columns: entry code, group, choreographer, participants, age band, song title, declared
length, props, stage setup, music state, contact name/email/phone, notes.

Follows the existing `/api/reports/*` convention (reconciliation and counselors already
export this way).

## 6. Coordinator notes

```prisma
notes String? // coordinator-visible, never shown to the entrant
```

"Needs 2 mics", "arriving late", "swapped song, chasing new file". There is nowhere to
put this today, so it lives in someone's phone. Not PII beyond what the entry already
holds; purged with the entry row's normal lifecycle.

## 7. Phone-first layout

The page already measures clean (899px, 0 undersized targets) and must stay that way as
it grows.

- **Summary block collapses to the three numbers that decide the show** — entries/capacity,
  runtime vs slot, music outstanding — with the rest behind a "More" disclosure. Eight
  summary figures fully expanded would push the roster below the fold, and the roster is
  the page.
- **Event picker becomes a select on narrow widths.** It is currently a wrapping row of
  buttons; at four events on 375px that is already two rows, and it grows every season.
- Filter chips scroll horizontally **only if** every chip's count is visible without
  scrolling — otherwise they wrap. The foundations spec's rule applies: nothing
  reachable only by horizontal scroll.
- Cards stay as they are. They were built with `min-h-tap` and measure correct.

---

## Schema changes

```prisma
model PerformanceEntry {
  durationSeconds Int      // was Int? — required for new entries
  notes           String?  // coordinator-visible
}

model ServiceCap {
  changeoverSeconds Int? // per-event changeover budget; null = 60s default
}
```

Additive apart from the `durationSeconds` nullability change, which stays nullable at
the database and is enforced at the schema/validation layer — so the two existing rows
with `null` are not rewritten with a fabricated value.

## Verification

Extend `scripts/verify-performance.ts`:

- Summaries compute correctly against a fixture with a known runtime, including the
  entries-with-no-length count.
- Each music filter returns exactly its bucket, and chip counts equal filter results.
- Offline and not-yet-uploaded are counted separately, never summed into one number.
- Unanswered props/stage-setup is its own count, not merged into "No".
- The event picker defaults to the soonest-upcoming event with entries, not the newest.
- CSV export contains one row per confirmed entry and no unpaid ones.

## Open questions

- **Category.** RoN's Google Form had a "Performance Category" question with exactly one
  option, so its intended values were never knowable. Confirm with the committee or drop
  the field — it is currently collected as free text and shown nowhere.
- **Who may see the roster.** It is `requireAdmin` today, so a volunteer coordinator
  cannot open it. The show team may not all be coordinators.
- **Capacity denominator when an event sells more than one entry type.** RoN currently
  has a stale `floor-admission` cap alongside `competition-entry`, so a naive sum reads
  540 rather than 40. The denominator must be the fee-kind cap, not the event total.
