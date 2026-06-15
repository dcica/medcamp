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

**Family Registration:**

One person can register and pay for multiple family members in a single checkout.

- Primary registrant fills their own details, then taps "+ Add Family Member"
- Each additional member: name, services selected (services and pricing are per person)
- Single Stripe checkout — total is the sum of all members' services
- One confirmation email with a separate QR badge for each family member
- Each member gets their own camp ID and label packet at check-in
- Members move through stations independently after check-in
- Marketing consent is captured once for the primary registrant
- Waiver must be acknowledged for each member individually
- Walk-in families: volunteer adds members one at a time before taking payment

**Cancellations:**

- Cancellations requested before camp day: full refund via Stripe for pre-registered patients; handled case-by-case for walk-ins
- Service-level cancellation (e.g., a specific service cannot be provided on the day): refund for that service only
- Family cancellation: all members cancelled together; individual member cancellation also supported
- No-shows: no automatic refund; contact sachin@buzzclan.com within 7 days

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

### Module 2 — Patient Label Packet
*The physical artifacts that replace verbal routing, handwritten sample IDs, and loose paper forms*

Every patient — pre-registered or walk-in — gets a label packet printed at check-in. The camp ID is the thread linking all physical artifacts to the digital record.

**Label types printed per patient:**

| Label | Size | Content | Used for |
|---|---|---|---|
| **Patient badge** | Large (2×4") | QR code + name + camp ID + color-coded service dots | Worn by patient throughout camp |
| **Form / waiver labels** | Small (1×2.5") | Name + camp ID + date | Affixed to intake form, waiver, any paper handout — 2–3 copies |
| **Sample labels** | Small (1×2.5") | Name + camp ID + sample type (Blood / Urine) | One per sample container; printed only for patients with lab services paid |
| **Address label** | Medium (2×4") | Name + mailing address | Printed post-camp as a batch when lab results arrive — not at check-in |

**How it works at the stations:**
- Blood draw station peels the pre-printed sample label off the sheet and applies it to the tube — no handwriting, no transcription errors
- All paper forms have a matching label → easy to reunite forms with the patient's digital record if needed
- Envelope is labeled at mailing time from the same system, not manually written

**Badge detail:**
- QR code scans to pull up the patient's service list at any station
- Color-coded dots correspond to stations (e.g., red = blood draw, blue = ultrasound, green = physician)
- Checklist of paid services printed on badge for quick visual confirmation

The label packet eliminates "which line do I go to?" confusion and removes handwriting from sample labeling entirely.

---

### Module 3 — Check-In Gate

When a patient arrives on camp day:

1. Volunteer scans the QR code from the patient's confirmation email (or prints it on-site for those without smartphones)
2. System confirms: ✓ Registered, ✓ Paid, ✓ Waiver signed
3. Patient receives their printed badge if not already in hand
4. System assigns the patient to their first station queue

Walk-ins who did not pre-register are handled at a dedicated walk-in desk adjacent to the main check-in.

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

### Module 5 — Coordinator Dashboard ("God View")

The camp coordinator gets a real-time overview of the entire operation:

- **Patient counts:** Total checked in, currently at each station, completed, pending payment
- **Queue depths per station:** Surface bottlenecks before they become jams (e.g., if ultrasound has 15 patients queued and blood draw has 2, redirect a volunteer)
- **Payment status:** Pre-paid, walk-in paid, pending add-ons
- **One-click export:** Post-camp summary, payment reconciliation report, and consented contacts list (name, email, phone) for membership drives

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

### Module 7 — Post-Camp Lab Tracking

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
| **6 — Lab Tracking & Patient Portal** | Weeks 17–19 | Lab status tracking + address label print + patient status lookup |
| **7 — Dry Run** | Weeks 19–22 | Simulate 100-patient flow with volunteers before camp |

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

*Document prepared by Sachin Jain. For questions or feedback, contact sachin@buzzclan.com.*
