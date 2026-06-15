---
title: Volunteer Module
nav_order: 4
---

# Volunteer Module

Volunteers are the backbone of every dcica event. This module covers the full volunteer lifecycle — recruitment, signup, confirmation, day-of attendance, and post-event recognition — as a **platform-level module reusable across every event type**, not just the medical camp.

A volunteer's profile persists across events (unlike patient records, which are camp-scoped and purged). Roles, age rules, and target counts are configured **per event**; the underlying volunteer roster, signup flow, QR check-in, and email infrastructure are shared platform components.

> **Not PHI.** Volunteers are staff, not patients. The no-PHI constraint applies to patient records only — volunteer profiles (contact, hours, history) are retained to support recruitment and recognition across events.

---

## Lifecycle Overview

```
Recruit ──► Sign Up ──► Confirm (24–48h) ──► Sign In / Out ──► Thank You + Certificate
   │           │              │                    │                     │
 outreach   per-event     reminder +          day-of QR              email +
 channels   role + age    instructions       attendance,          downloadable
            matching                          hours tracked         certificate
```

---

## 1 — Recruitment & Outreach

The committee actively recruits volunteers — this is not purely inbound. **Our primary volunteer base is students** — middle schools, high schools, and local colleges — for whom documented community-service hours are the main motivation. Outreach runs across several channels, all driving to one shared signup link per event.

**Channels:**

| Channel | How it works |
|---|---|
| Schools & colleges (primary) | Per-event outreach list of contacts at middle schools, high schools, and local colleges — counselors, honor-society / club / NHS advisors, service-learning coordinators. Template leads with **verifiable community-service hours + certificate** as the draw |
| Past volunteers | One-click email blast to the persistent volunteer roster ("You volunteered with us before — join us again"). Filterable by past role, event, or school |
| Social media | Recruitment post generated alongside the existing [Social Media Pack](MedCamp-System-Overview.md#module-5--coordinator-dashboard) — "We need [N] volunteers for [event] on [date] — sign up: [link]" |
| Community organizations | Same template, organization contact list (faith groups, civic clubs, corporate volunteer programs) |

Because students sign up in cohorts through a sponsoring teacher or advisor, the signup form captures **school / organization affiliation** so the coordinator can group volunteers by school and produce per-school hour summaries (see [Thank You & Certificates](#7--thank-you--certificates)).

**Outreach tracking:**
- Each channel gets a tagged signup link (`?src=school` / `?src=past` / `?src=social`) so the coordinator sees which channels convert
- Coordinator dashboard shows signups by source — informs where to focus next event

**No social media API integration** — recruitment text is generated for staff to copy and post manually, consistent with the rest of the platform.

---

## 2 — Signup Form

A single public page per event. Phone-first, no login required to sign up.

**Collected fields:**
- Name, email, phone
- Age band (see age rules below) — date of birth not stored, only the band needed for role eligibility
- **School / organization affiliation** (optional) + sponsoring teacher/advisor name — drives per-school grouping and hour summaries
- Role / task preferences (multi-select from the event's configured roles, ranked)
- Shift availability (if the event runs multiple shifts)
- Relevant skills / languages (free text + common tags: Spanish, medical background, driving, heavy lifting)
- Emergency contact (name + phone)
- T-shirt size (optional, for events that provide them)
- **Minor consent:** if age band is under 18, a parent/guardian name + signature is required before signup completes — mirrors the patient waiver-for-minors pattern. Most student volunteers are minors, so this is the common path, not the exception

**On submit:**
- Volunteer receives an immediate signup acknowledgement email
- If the volunteer's email matches an existing roster profile, the new event signup is linked to their persistent profile (no duplicate)
- Coordinator sees the new signup in the dashboard in real time

---

## 3 — Roles, Age Groups & Capacity

The coordinator configures volunteer needs **per event** before opening signups.

**Each role defines:**

| Field | Purpose |
|---|---|
| Role name | e.g. Registration desk, Runner, Greeter, Vitals assist, Crowd control, Setup/teardown |
| Description | Short summary of the task |
| Minimum age | Eligibility gate — drives age-group matching |
| Target count | How many volunteers needed (capacity cap) |
| Shift(s) | Time windows the role is staffed |
| Instructions | Role-specific brief, surfaced at confirmation and check-in |
| Linked station | Optional — ties the role to a camp station for context |

**Age groups by task:** roles carry a minimum age so volunteers are only offered tasks they're eligible for. Typical defaults (configurable):

| Age band | Typical school level | Eligible for |
|---|---|---|
| Under 16 | Middle school | Greeting, signage, runner, setup/teardown, hospitality |
| 16–17 | High school | Above + registration desk support, queue management (no payment till, no sample handling) |
| 18+ | College | All roles, including any task involving payment handling or proximity to clinical stations |

> Age gating is for **task suitability and supervision**, not clinical work — volunteers never perform medical procedures regardless of age.

**Capacity:** when a role hits its target count, it shows "Full" on the signup form (waitlist optional). The coordinator dashboard shows **filled vs. target per role**, surfacing under-staffed roles the same way the camp dashboard surfaces queue bottlenecks.

---

## 4 — Confirmation & Reminder (24–48h before)

An automated email goes out **24–48 hours before the event** to every signed-up volunteer.

**Confirmation email contains:**
- Confirmed role + shift time
- Venue address + arrival time + where to check in
- Role-specific instructions (what to do, what to bring — comfortable shoes, water bottle, etc.)
- Parking / entry notes
- A **QR code** for fast day-of sign-in (same QR/badge infrastructure as patient check-in)
- Cancel / can't-make-it link → frees the slot and alerts the coordinator

**Reminder logic:**
- Triggered on a per-event schedule the coordinator sets (default 48h, with an optional 2h day-of nudge)
- Volunteers who haven't opened/confirmed can be re-sent with one click
- SMS reminders are a possible enhancement (provider TBD); email is the primary channel at launch

---

## 5 — Day-Of Sign In / Out

Volunteers check in and out on arrival and departure — giving the coordinator a live roster and accurate hours for certificates.

**Sign in:**
1. Volunteer presents their confirmation QR (or is looked up by name)
2. System marks them **Checked In**, timestamps arrival, and shows their role + instructions on screen
3. Optional: print a volunteer badge (role + name + color, same label printer as patient badges)

**Sign out:**
- At end of shift, volunteer scans out → departure timestamped → hours computed automatically
- Coordinator can adjust hours manually (early leave, late stay)

**Coordinator view:**
- Live count: signed up / checked in / on site / checked out / no-show
- Per-role staffing vs. target in real time — redeploy volunteers from over-staffed to under-staffed roles
- No-shows flagged for follow-up and future recruitment filtering

---

## 6 — Instructions

Instructions are surfaced at three points so volunteers always know what to do:

1. **In the confirmation email** (24–48h out) — role brief + what to bring
2. **At check-in** — role instructions shown on the sign-in screen and on the printed badge
3. **Printable run sheet** — coordinator can print a per-role instruction sheet for the briefing, consistent with the [Operations Checklist](MedCamp-System-Overview.md#module-7--operations-checklist) printable artifacts

Instruction text lives on the role config, so it's reusable and editable per event.

---

## 7 — Thank You & Certificates

After the event, recognition is automated.

**Thank-you email:**
- Sent to all checked-in volunteers post-event
- Includes hours served and a warm note; ties into the membership-drive / future-recruitment messaging
- No-shows excluded; only volunteers who actually checked in are thanked and certified

**Certificate of appreciation (school-verifiable):**
- Auto-generated PDF per volunteer: name, event name + date, role, **hours served** (computed from sign in/out), organization name + 501(c)(3) status, and an authorized signature/logo
- Built to satisfy school community-service-hour requirements — verifiable, dated, signed; includes a verification contact (admin@dcica.org) a counselor can confirm against
- Downloadable from a link in the thank-you email and printable
- Coordinator can batch-issue, re-issue, or download all certificates as a set

**Per-school hour summary:**
- Because most volunteers come in school cohorts, the coordinator can generate a single summary per school/organization listing each student and their verified hours — sent to the sponsoring teacher/advisor or club
- Saves advisors from collecting individual certificates, and strengthens the relationship for the next event's recruitment

---

## Reusability Across Events

Everything above is event-agnostic. For any event type:

- **Shared:** volunteer roster (persistent profiles + history + hours), signup flow, QR check-in, email templates, certificate generator
- **Per-event config:** roles, age rules, target counts, shifts, instructions, outreach lists
- A medical camp configures clinical-support roles; a general fundraiser configures setup/hospitality roles — same module, different role set

This mirrors how [Events generalize the camp core](Platform-Extensions.md#module-1--events-general): the volunteer module is built once and reused, with per-event configuration doing the specialization.

---

## Additional Features

These extend the lifecycle above. All are event-agnostic and reuse the shared roster, QR, and email infrastructure.

### Recruitment & Retention
- **Returning-volunteer fast path** — a known email pre-fills the form from the persistent profile; one tap re-signs them for the new event.
- **Bring-a-friend referral** — each volunteer gets a shareable signup link; `referred_by` records who recruited whom (valuable for school cohorts spreading the word).
- **Reliability score** — sign-up vs. check-in vs. no-show history is tracked per profile and used to prioritize reliable volunteers for critical roles. Surfaced quietly to the coordinator, not punitive.

### Operations (Day-Of)
- **Waitlist auto-promote** — when a full role frees a slot (cancellation), the next waitlisted volunteer for that role is auto-offered the spot and notified.
- **Shift swaps** — volunteers can release a confirmed slot back to the waitlist via the cancel link.
- **Self check-in kiosk mode** — a tablet at the volunteer desk lets volunteers scan their own QR to sign in, mirroring the patient check-in gate (vs. a volunteer scanning each).
- **Break / coverage tracking** — `on_break` status keeps the live roster honest about who's actually at a post.
- **Station coverage view** — because roles link to camp stations, the coordinator sees volunteer staffing against live [queue depth](MedCamp-System-Overview.md#module-5--coordinator-dashboard) in one place, and redeploys accordingly.

### Recognition & Compliance
- **Lifetime hours + milestone badges** — cumulative hours roll up on the profile; milestones (25h / 50h / 100h) are awarded automatically — a strong retention lever for repeat student volunteers.
- **Role clearance flags** — roles can require a one-time training or background-check flag (`cleared_roles`) before a volunteer may sign up — relevant for any role with payment-till access or close work near clinical stations.
- **Group/org rollup certificate** — a single summary per school/club showing total hours contributed by all its members, for the advisor (extends the per-school hour summary above).

### Communications
- **Day-of broadcast** — coordinator pushes a message to all on-site (checked-in) volunteers ("need 2 people at blood draw now", "lunch in room 3").
- **Post-event feedback survey** — a one-question prompt in the thank-you email; `feedback_score` informs the next camp.

---

## Data Model

```
Volunteer (persistent — across events)
  ├── volunteer_id
  ├── name, email, phone
  ├── age_band                 ← under_16 | 16_17 | 18_plus (DOB not stored)
  ├── school_affiliation { name, advisor_name }   ← optional; drives per-school rollup
  ├── skills[], languages[]
  ├── cleared_roles[]          ← one-time training/background flags satisfied
  ├── emergency_contact { name, phone }
  ├── total_hours_lifetime
  ├── milestones[]             ← e.g. 25h, 50h, 100h badges
  ├── reliability { events_signed_up, checked_in, no_shows }
  ├── referred_by              ← volunteer_id of recruiter (bring-a-friend)
  └── event_history[]          ← links to past VolunteerSignup records

VolunteerRole (per event — configurable)
  ├── role_id
  ├── event_id
  ├── name, description
  ├── min_age                  ← drives age-group eligibility
  ├── target_count             ← capacity cap
  ├── requires_clearance       ← role needs training/background flag before signup
  ├── shifts[] { start, end }
  ├── instructions             ← surfaced at confirmation + check-in
  └── linked_station_id        ← optional (camp context)

VolunteerSignup (per event — links volunteer ↔ event ↔ role)
  ├── signup_id
  ├── event_id
  ├── volunteer_id
  ├── role_id, shift
  ├── source_tag               ← social | past | school | org (outreach attribution)
  ├── minor_consent { guardian_name, signed_at }   ← if age_band = under_16/16_17
  ├── status                   ← signed_up | waitlisted | confirmed | checked_in | on_break | checked_out | no_show | cancelled
  ├── checked_in_at, checked_out_at
  ├── hours_served             ← computed, manually adjustable
  ├── feedback_score           ← optional post-event survey response
  └── certificate_issued       ← boolean

OutreachList (per event)
  ├── event_id
  ├── channel                  ← past_volunteers | school | org | social
  ├── contacts[]               ← name, email (schools/orgs only)
  └── signup_link              ← source-tagged
```

---

## Access Roles

| Role | Volunteer-module access |
|---|---|
| Coordinator | Full — configure roles, set targets, send outreach + reminders, view live roster, issue certificates |
| Volunteer Coordinator | Same as above, scoped to the volunteer module (delegated by Coordinator) |
| Committee / admin | View signups and reports, manage outreach lists |
| Check-in volunteer | Sign volunteers in/out (scan), view roster — no role config |
| Volunteer (public) | Sign up, confirm, cancel, download certificate — no login |

---

## Build Order

The volunteer module is a platform extension, built alongside the other reusable modules after the core camp phases. See the [Platform Extensions build order](Platform-Extensions.md#build-order-after-camp-modules).

| Stage | What gets built |
|---|---|
| Signup + roles | Public signup form, per-event role config, age rules, capacity caps |
| Confirmation | 24–48h reminder email with QR + instructions, cancel flow |
| Day-of | QR sign in/out, live coordinator roster, hours tracking |
| Recognition | Thank-you email + certificate generator + batch issue |
| Outreach | Past-volunteer blast, school/org lists, source-tagged links + attribution |

---

*Questions or feedback: admin@dcica.org*
