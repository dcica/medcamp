# Platform Extensions

The core medcamp system is being extended into a full non-profit event management and commerce platform for dcica. All modules share the same Stripe integration, Google auth, and phone-first UI.

---

## Platform Architecture

```
dcica Platform
  ├── Events Module      → registration, entry fee, check-in, QR badge
  │     └── Camp Module  → station routing, labels, supplies, lab tracking
  ├── Membership Module  → annual/multi-year plans, member card, renewals
  ├── POS Module         → merchandise sales, Tap to Pay, no inventory
  └── Vendor Module      → registration, Zelle payment, spot assignment
```

---

## Module 1 — Events (General)

Extends the medical camp registration/check-in core to support any event type.

- Event creation: name, date, venue, capacity, entry fee (or free)
- Registration: name, phone, mailing address, ticket selection, Stripe checkout
- QR code badge / ticket on confirmation
- Day-of check-in: QR scan on volunteer's phone
- Coordinator view: headcount, check-in rate, revenue

The medical camp is a specialization of this — it adds station routing, label printing, supply calculator, and lab tracking on top of the general event foundation.

---

## Module 2 — Membership

Annual and multi-year membership for the organization.

**Plans:**
- Annual membership (1 year from purchase date)
- Multi-year (2-year, 3-year, etc. — one-time payment, not recurring subscription)

**Member record:**
- Member ID (QR-coded member card)
- Name, phone, mailing address, email
- Plan, start date, expiry date
- Payment: Stripe one-time charge (not subscription — simpler for multi-year)
- Status: Active | Expired | Cancelled

**Workflows:**
- Self-serve signup on the website
- Renewal reminder email sent 30 days before expiry
- Member card: printable QR card (same label printer as camp)
- Staff can look up any member by name or member ID
- At events: member QR scanned to verify active membership (discount or free entry)

**No recurring billing** — member pays upfront for the full term. Renewal is a new purchase.

---

## Module 3 — POS (Onsite Sales)

Merchandise sales at events. No inventory tracking needed.

- Admin sets up a product list per event (name + price)
- Volunteer opens POS view on their phone
- Tap items to add to cart → total shown → customer taps phone/card (Stripe Tap to Pay)
- Receipt optional (email or skip)
- Sales log visible to coordinator in real time

Payment: Stripe Tap to Pay (same as walk-in camp registrations — no extra hardware).

---

## Module 4 — Vendor Registration

Vendors are present at **all events** and are critical to fundraising. The committee actively recruits and markets to vendors — this is not just inbound self-registration.

**Vendor types and fee tiers:**

| Type | Notes |
|---|---|
| Food | Full commercial rate (TBD per event) |
| Merchandise | Full commercial rate (TBD per event) |
| Non-profit | Discounted rate (TBD per event) |
| Education | Discounted rate (TBD per event) |

**Two-stage registration flow:**

```
Vendor applies
    │
    └─► Committee reviews in admin panel
              │
    ┌─────────┴──────────┐
    │ Approved            │ Rejected
    │ Email sent with     │ Email sent with
    │ Zelle instructions  │ reason
    │ + amount due        │
    └─────────────────────┘
              │
    Vendor sends Zelle payment
    (memo = Vendor ID for matching)
              │
    Staff verifies in bank app
    → marks Payment Received
              │
    Staff assigns booth in system
    → Confirmation email sent to vendor
       (booth number, setup time, event details)
```

**Why Zelle for vendors:**
- Vendor fees are larger amounts — avoids Stripe processing fees entirely
- Zelle is free, instant bank-to-bank transfer
- Tradeoff: no automated payment verification — staff manually confirms receipt

**Booth assignment:**
- Each event has a configurable booth map (numbered slots with type: indoor / outdoor / corner / standard)
- Staff assigns approved + paid vendors to slots from a simple grid view
- Booth number included in confirmation email
- Staff can reassign slots before event day

**Vendor record:**

```
Vendor
  ├── vendor_id              ← used as Zelle memo
  ├── event_id
  ├── business_name, contact_name, phone, email
  ├── vendor_type            ← food | merchandise | nonprofit | education
  ├── space_requested        ← single / double / corner
  ├── fee_due
  ├── application_status     ← pending | approved | rejected
  ├── payment_status         ← unpaid | received | confirmed
  ├── booth_assignment       ← booth number / location label
  └── notes                  ← committee notes on application
```

**Staff-side vendor pipeline view:**
- List of all vendor applications per event
- Filter by status (pending review / approved awaiting payment / paid / confirmed)
- One-click approve/reject with auto-email
- Payment confirmation toggle (after checking Zelle)
- Booth assignment interface

**Vendor-facing:** Confirmation email only (no portal needed at this stage). Email includes booth number, setup time window, event day details.

---

## Revised Data Model

```
Organization (dcica)
  └── Event
        ├── event_id
        ├── type: medical_camp | general | fundraiser | fair
        ├── date, venue, capacity
        ├── entry_fee
        └── modules_enabled[]   ← e.g. [station_routing, vendor, pos]

Registration (per event)
  ├── registration_id
  ├── event_id
  ├── name, phone, mailing_address
  ├── line_items[]              ← tickets, services, membership
  ├── stripe_payment_id
  ├── qr_code
  └── [camp-only fields]
        ├── waiver_signed
        ├── station_visits[]
        └── lab_status

Membership
  ├── member_id
  ├── name, phone, email, mailing_address
  ├── plan (annual | 2yr | 3yr)
  ├── start_date, expiry_date
  ├── stripe_payment_id
  └── status: active | expired | cancelled

Product (POS)
  ├── event_id
  ├── name, price
  └── active

Sale (POS)
  ├── event_id
  ├── items[]
  └── stripe_payment_id

Vendor
  ├── vendor_id              ← = zelle_memo for manual matching
  ├── event_id
  ├── business_name, contact_name, phone, email
  ├── vendor_type            ← food | merchandise | nonprofit | education
  ├── space_requested        ← single | double | corner
  ├── fee_due
  ├── application_status     ← pending | approved | rejected
  ├── payment_status         ← unpaid | received | confirmed
  ├── booth_assignment
  └── notes

BoothSlot (per event)
  ├── event_id
  ├── slot_id (booth number / label)
  ├── type                   ← indoor | outdoor | corner | standard
  └── vendor_id              ← null if unassigned
```

---

## Payment Methods by Module

| Module | Payment Method | Why |
|---|---|---|
| Event registration | Stripe (online + Tap to Pay) | Seamless checkout, automated |
| Membership | Stripe (online) | Self-serve, automated |
| POS / merchandise | Stripe Tap to Pay | No hardware, instant |
| Vendor registration | Zelle | Large amounts, avoids processing fees |

---

## Build Order (after camp modules)

Camp modules (Phases 1–6) are built first for the winter camp. Platform extensions follow:

| Phase | What Gets Built |
|---|---|
| **7 — General Events** | Generalize camp registration into event registration; entry fee checkout |
| **8 — Membership** | Signup, renewal reminders, member card, event verification |
| **9 — POS** | Merchandise product list, Tap to Pay checkout, sales log |
| **10 — Vendor** | Vendor registration form, Zelle instructions, staff payment confirmation, spot assignment |
