---
title: System Overview
nav_order: 2
---

# MedCamp Management System
## Project Overview — Committee Review Draft
**Prepared:** June 2026  
**Status:** Pre-Development — Seeking Committee Feedback

---

## Background

Our medical camps have grown to serve 300–500 patients in a single half-day session. The operations model that got us here — Google Forms for registration, Square for payment, paper forms at walk-in, and volunteers verbally routing patients — is at its limit. We turn away volunteers because we can't absorb more people into a disorganized process. The problem is not staffing; it's the lack of a coordinating system.

This document outlines a purpose-built MedCamp Management System to automate and streamline every phase of the camp, from pre-registration to post-camp reconciliation. It is designed specifically around how our camps work — no excess features, no unnecessary complexity.

**One firm constraint:** No Health Information Technology (HIT) / Protected Health Information (PHI) is stored. Patient records are camp-scoped and purged after each event.

---

## What We're Solving

| Problem Today | Impact |
|---|---|
| Registration (Google Forms) and payment (Square) are two separate, unlinked systems | Manual reconciliation takes hours; errors are common |
| Walk-in patients fill out paper tripart forms by hand | Slow, error-prone, no digital record |
| No patient routing system — volunteers herd patients verbally | Bottlenecks at popular stations; patient confusion |
| No sticker/badge linking patient to their paid services | Station volunteers can't verify what a patient is there for |
| Supply ordering is experience-based, not data-driven | Risk of running short on high-demand items |
| No real-time visibility for the camp coordinator | Coordinator can't see bottlenecks until a line forms |

---

## System Overview

The system has six functional modules, designed to be built in sequence so we have something working well before the winter camp.

---

### Module 1 — Unified Registration & Payment Portal

Patients visit a single web page to register and pay in one flow.

**Pre-registration (online, before camp day):**
- Patient enters name, phone number, email, mailing address, and selects services from our menu
- Pricing is shown live as services are added
- **Marketing consent checkbox** (opt-in, not required): _"I agree to be contacted by dcica for updates, membership drives, and future events."_ Consent and timestamp are recorded.
- Stripe Checkout is embedded — registration is not confirmed until payment clears
- On payment success: patient receives a confirmation email containing their **QR code badge**
- Capacity limits per service are enforced (e.g., ultrasound capped at 80 slots) so we never overbook a station

**Walk-in registration (day-of, at the registration desk):**
- Volunteer uses a tablet to enter the patient's information including email
- Marketing consent checkbox presented on tablet — volunteer reads it aloud if needed
- Patient pays via Stripe Tap to Pay on volunteer's phone
- Badge is printed immediately at the desk
- Digital waiver is signed on the tablet (with paper fallback available)

**Group / Family Registration:**

One person can register and pay for any number of attendees — including cases where the person filling out the form is not attending themselves (e.g., a parent registering children, a caretaker registering a family member).

- Registration starts by collecting the **registrant's contact details** (name, email, phone) for confirmation and communication — these are not camp attendee details
- Registrant is then asked: "Who are you registering?" and adds one or more attendees
- Each attendee: name, services selected, waiver acknowledgement — no assumption that the registrant is one of them
- If the registrant is also attending, they add themselves as one of the attendees
- Single Stripe checkout — total is the sum of all attendees' services
- One confirmation email to the registrant with a separate QR badge for each attendee
- Each attendee gets their own camp ID and label packet at check-in
- Attendees move through stations independently after check-in
- Marketing consent is captured once from the registrant
- Walk-in groups: volunteer collects registrant contact info, then adds attendees one at a time before payment

**Cancellations:**

- Cancellations requested before camp day: full refund via Stripe for pre-registered patients; handled case-by-case for walk-ins
- Service-level cancellation (e.g., a specific service cannot be provided on the day): refund for that service only
- Family cancellation: all members cancelled together; individual member cancellation also supported
- No-shows: no automatic refund; contact admin@dcica.org within 7 days

---

**Service Menu (current pricing):**

| Service | Price |
|---|---|
| First consultation | Free |
| Additional consultation | $5 |
| Blood test | $8–$15 per test |
| Ultrasound | $40 |
| X-ray | $40 |
| Vitamin B12 or D shot | $10 per shot |
| Blood bank (planned next camp) | TBD |

---

### Module 2 — Progress Report Sheet & Label Packet
*The physical artifacts that replace verbal routing, handwritten sample IDs, and loose paper forms*

Every patient — pre-registered or walk-in — gets **one A4 progress report sheet** plus a small set of stickers. The camp ID is the thread linking all of it to the digital record. Visual specifications live in the [Design System](Design-System.md).

**The progress report sheet (one per patient):**

A single A4 page that is both the **doctor's note-taking sheet** and the **patient's take-home record**:

- **Header** — QR code + name + camp ID. This QR is the *staff* scan target: scanning it at a station pulls up the patient's paid-service list. (Tied to the camp-scoped record, purged after camp.)
- **Care Spine rail** down the left margin — the patient's enrolled stations in routing order, each a color band (red = blood draw, blue = ultrasound, green = physician, etc.) with a letter and step number. The doctor or tech **pen-checks each band when they finish seeing the patient**; the next station is the topmost un-checked band. This is the wayfinding that replaces "which line do I go to?"
- **Body** — paid-services confirmation, the doctor's notes/advice space, and an **Add service** line that captures a mid-visit add-on into the *Needs payment* flow.
- **Take-home footer** — a second QR (the *patient's* link) to the persistent public camp page: meet the doctors who volunteered, and check lab status. The camp ID doubles as the lab-status lookup code.

**The patient keeps the sheet.** Because the clinical notes go home with the patient, dcica retains *no* clinical content — the system stores only identity and paid services, and purges those after camp. There is nothing to collect or shred.

**Multi-page packets.** A patient seeing several specialists may need more than one page. Page 1 carries the rail, header, and footer; additional **consult-note pages** are stapled into a single packet the patient carries. Every page runs a header of name + camp ID + "Page X of Y" (identity only) so a stray page can always be reunited. Continuation pages are estimated from the patient's consults at print time, and a doctor can request another at the desk — which is why the print/check-in desk keeps a **stapler** on hand.

**Printing:** Print the full color sheet on a color laser (A4). **Pre-print the ~80% pre-registered patients the night before** (their services are known); print only walk-ins live at the desk, so one printer keeps up. Where no color printer is available, the fallback is a pre-printed B&W sheet with the rail in grayscale — the letter + number + check boxes still carry it.

**Stickers (thermal label printer):**

| Label | Size | Content | Used for |
|---|---|---|---|
| **Sample labels** | Small (1×2.5") | Station color + name + camp ID + sample type (Blood / Urine) | Peeled and applied to each sample tube — no handwriting; printed only for patients with lab services paid |
| **Form / waiver labels** | Small (1×2.5") | Name + camp ID + date | Affixed to the signed waiver or any paper handout |
| **Address label** | Medium (2×4") | Name + mailing address | Printed post-camp as a batch when lab results arrive — not at check-in |

The blood-draw station peels the pre-printed sample label onto the tube — no handwriting, no transcription errors. Mailing envelopes are labeled from the same system at mailing time.

---

### Module 3 — Check-In Gate

When a patient arrives on camp day:

1. Patient presents confirmation code or QR from their confirmation email (volunteer can also look up by name)
2. System confirms: ✓ Registered, ✓ Paid, ✓ Waiver signed
3. Patient receives their printed progress report sheet (and sample labels, if they have lab services)
4. System assigns the patient to their first station queue

**Waiver for Minors:**

A minor cannot sign their own waiver. The system flags any attendee registered as a minor and requires a parent or guardian signature on their behalf.

- During online registration: the registrant signs the waiver for each minor attendee — the form labels it clearly as "Parent / Guardian signature for [minor's name]"
- At walk-in: the adult accompanying the minor signs the waiver on the tablet (or paper) before the minor is checked in
- If a minor arrives at check-in without an accompanying adult who signed the waiver, they cannot be checked in — the system blocks check-in and alerts the volunteer to contact the registrant
- Minor flag is set if the attendee's age is under 18 (age collected at registration — not stored post-camp, used only for this check)

**Walk-In Registration Window**

Walk-ins are not turned away, but registration opens on a delay to protect pre-registered patients and allow initial flow to stabilize.

- **Camp opens:** Only pre-registered check-in is active; walk-in desk displays "Walk-in registration opens at [time]"
- **After ~1 hour** (or when coordinator manually opens it): walk-in registration activates
- The coordinator toggles walk-in registration open/closed from the dashboard — no fixed timer, based on real flow
- Walk-in patients waiting during the hold period are given an estimated wait time and directed to the waiting area
- Once open: walk-in desk processes registration, payment, and badge print in a single flow

This mirrors the current practice of holding walk-ins for approximately one hour while pre-registered patients clear initial intake.

---

### Module 4 — Station Queue Management

Each station (doctor's office, blood draw, ultrasound, etc.) has a tablet or screen showing their live queue. The flow:

1. Patient arrives at station → volunteer scans QR badge → patient marked **In Progress**
2. Service completed → volunteer marks **Done**
3. System automatically routes patient to their next station and adds them to that queue

**Default routing order:**  
`Vitals → Doctor Consultation → [variable: Blood Draw / Ultrasound / X-Ray / EKG / Shots]`

**Add-on services (doctor recommends something not pre-paid):**
- Doctor taps "Add Service" on their tablet
- Patient's record is flagged as **Needs Payment**
- Registration desk receives an instant alert
- A volunteer escorts the patient back to the registration desk to pay
- Once paid via Square, the new service is added to the patient's badge and they are routed to the appropriate station

---

### Module 5 — Coordinator Dashboard

The camp coordinator gets a real-time overview of the entire operation:

- **Patient counts:** Total checked in, currently at each station, completed, pending payment
- **Queue depths per station:** Surface bottlenecks before they become jams (e.g., if ultrasound has 15 patients queued and blood draw has 2, redirect a volunteer)
- **Payment status:** Pre-paid, walk-in paid, pending add-ons
- **Walk-in registration toggle:** Open or hold walk-in desk from the dashboard
- **Operations checklist:** Live checklist progress across all phases

**Post-Camp Exports (one-click):**

| Export | Contents |
|---|---|
| Payment reconciliation | All transactions, amounts, payment method, add-ons |
| Consented contacts | Name, email, phone of opted-in patients — for membership drives |
| Camp summary | Headcount by service, total revenue, walk-in vs. pre-registered split |
| Social media pack | Ready-to-paste text for Instagram, Facebook, and X |

**Social Media Pack** is generated automatically from camp data — no manual drafting:

- **Event announcement** (pre-camp): generated when registration opens; includes event date, services, registration link
- **Thank-you post** (post-camp): "We served [N] patients at our [event name] camp! Thank you to our volunteers and community." — numbers pulled from final headcount
- **Medical staff thank-you** (post-camp): "Thank you to the [N] doctors and techs who volunteered — see who showed up: [camp page link]" — links to the public camp page
- **Sponsor shout-outs** (post-camp): one post per confirmed sponsor, pulling their name and tier from the sponsor records — "Thank you to our [Platinum/Gold/...] sponsor, [Business Name]!"
- **Membership drive post**: generated from consented contact count — "Enjoyed the camp? Join the dcica family — [link]"

Every post links back to the **public camp page** (the same page patients reach from their progress report QR): the medical-staff roster, sponsor thanks, lab-status lookup, and the feedback/review prompt all live there, so it's the single canonical destination for post-camp traffic. Staff copies text and posts manually to their preferred platforms. No social media API integration — no additional accounts, permissions, or scheduling needed.

Accessible on any phone or laptop — no special hardware needed.

---

### Module 6 — Supply Calculator

Before each camp:

- Enter the number of registered patients per service
- System generates a recommended procurement list (e.g., "80 ultrasound registrations → confirm gel, probe covers, etc.")
- Manual override available per item
- Printable list to share with our pharmacy and physician procurement partners

Supply categories: Medical, Food, Stationery.

Supply tracking is pre-camp only — no mid-camp inventory system needed.

---

### Module 7 — Operations Checklist

A phase-based checklist covering everything that needs to happen before, during, and after camp. Printable for day-of use when volunteers may not have a device in hand.

**Phases:**

| Phase | When |
|---|---|
| Pre-camp (week before) | Procurement, printing, volunteer briefing |
| Day-of setup (before doors open) | Physical setup, system checks, signage |
| During camp | Operational reminders, timed actions |
| Post-camp | Close-out, data export, lab tracking, purge |

**How it works:**
- Admin configures a checklist template per event (items can be added, removed, reordered)
- Each item has a category (Signage / Supplies / Tech / Logistics / System), an assigned role, and a flag for whether it produces a printable artifact
- On camp day, the coordinator opens the checklist on their phone — items are checked off as done
- Checklist is also printable as a clean sheet for clipboard use

**Printable artifacts generated by the system (not manually created):**

| Sign / Document | Content | Used where |
|---|---|---|
| Walk-in hold sign | "Walk-in registration opens at [time set by coordinator]" | Walk-in desk, entrance |
| Station directional signs | Station name + color code | Arrows through venue |
| Queue number display | "Now serving: [number]" | Waiting area TV |
| No photography sign | Per event setting | As needed |
| Waiver reminder sign | "Please have waiver ready" | Check-in queue |

**Sample default checklist items:**

*Pre-camp (week before):*
- [ ] Confirm volunteer count and role assignments
- [ ] Order supplies (medical, food, stationery) per supply calculator output
- [ ] Print volunteer role cards
- [ ] Confirm lab partner and sample collection supplies
- [ ] Test label printer with a sample badge run

*Day-of setup (before doors open):*
- [ ] Print and post walk-in hold sign at entrance and walk-in desk
- [ ] Print and post station directional signs
- [ ] Set up and test label printer at registration desk
- [ ] Charge all tablets and QR scanners overnight — confirm battery levels
- [ ] Confirm WiFi coverage at all stations; activate hotspot backups
- [ ] Load coordinator dashboard and confirm all stations showing
- [ ] Set walk-in registration open time on coordinator dashboard
- [ ] Brief volunteers on their station and scanning procedure

*During camp:*
- [ ] Open walk-in registration (coordinator toggle — approx. 1 hour after open)
- [ ] Monitor queue depths — redistribute volunteers if a station backs up
- [ ] Confirm supply levels at blood draw and injection stations at midpoint

*Post-camp:*
- [ ] Export payment reconciliation report
- [ ] Export consented contacts list for membership drive
- [ ] Purge patient registration records
- [ ] Return borrowed tablets
- [ ] Log supply usage for next camp's procurement baseline
- [ ] Monitor for incoming lab results (see Module 8)

**Data model:**

```
ChecklistTemplate
  ├── template_id
  ├── event_id
  ├── phase: pre_camp | day_of | during | post_camp
  └── items[]
        ├── description
        ├── category: signage | supplies | tech | logistics | system
        ├── assigned_role
        └── print_artifact: boolean

ChecklistRun (instance per camp)
  └── items[]
        ├── status: pending | done
        ├── completed_by
        └── completed_at
```

---

### Module 8 — Post-Camp Lab Tracking

Lab results are returned as physical paper reports by the lab. The system handles the mailing logistics only — no digital lab results are stored.

**Staff workflow:**
1. Lab reports arrive (days or weeks after camp)
2. Staff opens the system and marks patients `Lab Received` — individually or as a batch
3. System prints a sheet of **address labels** (same label printer used for badges) — one per patient in the batch
4. Staff stuffs envelopes, applies labels, mails
5. Staff marks batch as `Mailed`

**Patient status portal:**
- Patient visits the camp website and enters their confirmation code
- No login required — lookup by camp ID only
- Status shown: `Lab Pending` → `Lab Received` → `Mailed on [date]`
- No clinical information displayed — logistics status only

This keeps lab results entirely on paper while giving patients visibility into where their results are.

---

## Venue Configurations

The system supports two physical layouts. The coordinator selects the configuration when setting up each camp.

### Configuration A — Clinic (Current Setup)

| Zone | Location |
|---|---|
| Registration / Check-in | Clinic front |
| Doctor consultations | 7 rooms |
| Vitals | Outdoor tent |
| Blood draw | Outdoor tent |
| Imaging (X-ray, Ultrasound) | Clinic rooms |

### Configuration B — Open Space (Future: Gym / Basketball Court)

| Zone | Setup |
|---|---|
| Patient entry | Main entrance |
| Waiting area | Open floor (chairs, numbered sections) |
| Registration / Check-in | Dedicated table zone near entrance |
| Doctor consultations | Portable cabins / dividers |
| Vitals | Cabin or open station |
| Blood draw | Cabin |
| Imaging | Cabin or dedicated room if available |

In the open-space configuration, TV screens mounted near the waiting area can display patient queue status by camp ID number — patients see their number called without a volunteer announcing it.

---

## Access Roles & Payment Controls

| Role | System Access | Cash | Waiver |
|---|---|---|---|
| Coordinator | Full dashboard, all modules, volunteer setup | Can assign | Yes |
| Registration desk — till holder | Registration, payment, badge print, cash + Stripe | Yes | No |
| Registration desk — no till | Registration, payment, badge print, Stripe only | No | No |
| Registration desk — override auth | Registration, payment, badge print, Stripe + waiver | Till if also assigned | Yes |
| Station volunteer | Own station queue (scan in/out) | No | No |
| Doctor | Station view + add-on service flag | No | No |
| POS volunteer — till holder | Merchandise POS, cash + Stripe | Yes | No |
| Committee / admin | Supply calculator, camp setup, reports | No | Configurable |

**Till assignment:**
- Coordinator assigns till holders before camp day in the system
- Volunteers with a till see both Stripe Tap to Pay and cash as payment options
- Volunteers without a till see Stripe only — the cash option is hidden from their screen entirely
- If a patient wants to pay cash and the volunteer has no till, screen prompts: "For cash payment, please visit the **till desk**"
- Each till holder's cash transactions are logged separately for end-of-day reconciliation
- Coordinator dashboard shows a per-till cash summary: total collected, number of transactions

**Payment override authorization:**
- Override permission is a separate flag, assigned by the coordinator — independent of till access
- Waiver option is hidden from all non-authorized volunteers — not visible on their screen
- Every waiver requires a mandatory reason: Financial hardship / Volunteer or staff / Committee decision / Complimentary / Other (free text)
- Full waiver log visible to coordinator in real time; included in post-camp reconciliation export as a separate section
- Partial waivers supported: one service waived, remainder paid normally

---

## What the System Does NOT Do

To keep this focused and avoid unnecessary complexity:

- **No PHI storage** — no diagnoses, prescriptions, or clinical notes. Lab results remain on paper; the system tracks only mailing status (received / mailed)
- **No cross-camp patient history** — each camp is a clean registration
- **No telehealth or remote access for clinicians**
- **No insurance billing**
- **No HIPAA-covered data workflows**

---

## Technology

The system will be a web application accessible on any modern phone, tablet, or laptop — no app installation required for volunteers.

| Component | Technology |
|---|---|
| Web application | Next.js (works on phones, tablets, TV displays) |
| Database | PostgreSQL (patient records purged post-camp) |
| Payments | Square (Web SDK for online, Terminal SDK for walk-in) |
| Login / Access control | Google Workspace accounts (committee already has these) |
| Badge / QR codes | Browser print (works with standard label printers) |
| Hosting | Cloud-hosted, no on-site server required |

Internet connectivity: reliable WiFi assumed; phone hotspot backup available.

### UI Constraint — Phone-First Design

**Every volunteer-facing screen must work on a 6" phone screen with no pinching, zooming, or horizontal scrolling.** Tablets and laptops show the same interface at a larger size — they are not required for any station to function.

This means:
- Large tap targets (minimum 48px) for station check-in and mark-done actions
- Single-column layouts on all queue and scan views
- QR scanning via phone camera — no external scanner required (dedicated scanners at high-volume stations are an enhancement, not a dependency)
- Label printing triggered from phone → prints to the shared WiFi label printer at the registration desk
- Coordinator dashboard readable on a phone; expands to a richer layout on larger screens

---

## Build Plan — 6 Months to Winter Camp

| Phase | Timeline | What Gets Built |
|---|---|---|
| **1 — Registration Portal** | Weeks 1–4 | Unified registration + Square checkout + QR confirmation email |
| **2 — Check-In & Badge** | Weeks 5–7 | Gate scan + digital waiver + badge printing |
| **3 — Station Flow** | Weeks 8–11 | Queue tablets + patient routing + add-on payment alert |
| **4 — Coordinator Dashboard** | Weeks 12–14 | God-view + reconciliation export |
| **5 — Supplies & Venue Config** | Weeks 15–17 | Supply calculator + clinic vs. open space setup |
| **6 — Checklist Module** | Weeks 17–18 | Phase-based checklist + printable signs + day-of run sheet |
| **7 — Lab Tracking & Patient Portal** | Weeks 18–20 | Lab status tracking + address label print + patient status lookup |
| **8 — Dry Run** | Weeks 20–22 | Simulate 100-patient flow with volunteers before camp |

The system is designed so that **Phase 1 alone delivers significant value** — replacing the Google Forms / Square reconciliation problem. Each subsequent phase adds capability without requiring the previous phase to be perfect.

---

## Questions for Committee

1. **Services:** Are there any services we offer that are not listed in the pricing menu above? Any planned additions beyond blood bank?

2. **Walk-in cap:** Should we enforce a hard cap on walk-in capacity, or accept all walk-ins regardless of pre-registration numbers?

3. **Station routing:** Is there a mandatory order certain patients must follow (e.g., must see a doctor before getting an ultrasound)? Or is the routing always flexible?

4. **Waiver:** Should we use digital signature (tablet) as the primary method, with paper as fallback? Or keep paper as primary?

5. **Volunteer roles:** Which committee members / volunteer roles should have access to which parts of the system? (Example: station volunteers can only see their queue; coordinator sees everything; registration desk can process payments)

6. **Post-camp data:** What summary data do we need to retain after purging patient records? (e.g., total patients by service, revenue by service, supply usage)

7. **Languages:** Do we need Spanish-language registration forms for the winter camp?

8. **Blood bank:** If we secure a blood bank for the winter camp, is that a donation station (patients donating blood) or a dispensing station?

---

## Next Steps

Upon committee feedback:
1. Finalize service menu and station list for winter camp
2. Confirm venue (clinic vs. open space) for winter camp
3. Begin Phase 1 development — registration portal
4. Identify 2–3 volunteers to test the system in a dry run

---

*Document prepared by Sachin Jain. For questions or feedback, contact admin@dcica.org.*
