---
title: Payment Gateway
nav_order: 4
---

# Payment Gateway

## Platform Decision

Three options were evaluated. Square is the current working platform and likely the final choice, but the committee should confirm non-profit registration status — Stripe's non-profit tier may offer meaningful savings at scale.

### Comparison

| | Square | PayPal | Stripe |
|---|---|---|---|
| **Online rate (standard)** | 2.9% + $0.30 | 2.99% + $0.49 | 2.9% + $0.30 |
| **In-person rate (standard)** | 2.6% + $0.10 | 2.29% + $0.09 | 2.7% + $0.05 |
| **Non-profit rate** | No dedicated tier | 1.99% + $0.49 (501(c)(3) verified) | 2.2% + $0.30 (501(c)(3) verified) |
| **In-person method** | Tap to Pay on phone (NFC) | Tap to Pay on phone (NFC) | Tap to Pay on phone (NFC) |
| **Hardware required** | None — phone only | None — phone only | None — phone only |
| **Already in use** | Yes | No | No |
| **Developer SDK quality** | Good | Dated | Excellent |
| **Non-profit application** | N/A | paypal.com/us/webapps/mpp/givingfund | stripe.com/docs/tax-exempt |

### Savings at Camp Scale

At 300 patients averaging $25/patient = $7,500 per camp:

| Provider | Rate | Fee per camp |
|---|---|---|
| Square (standard) | 2.9% + $0.30 | ~$308 |
| PayPal non-profit | 1.99% + $0.49 | ~$297 |
| Stripe non-profit | 2.2% + $0.30 | ~$255 |
| Square in-person only | 2.6% + $0.10 | ~$225 |

Difference between Square standard and Stripe non-profit: ~$53/camp. Modest at this volume, but worth capturing if non-profit status is already registered.

### Decision

**Stripe — confirmed.** Organization is a registered 501(c)(3). Stripe non-profit rate (2.2% + $0.30) applies. No terminal hardware switching cost since in-person payments use Tap to Pay on a volunteer's phone. Stripe SDK is the best fit for a custom Next.js build.

**Action items:**
- [x] 501(c)(3) status — confirmed
- [ ] Apply for Stripe non-profit rate: stripe.com/docs/tax-exempt (requires EIN and 501(c)(3) determination letter)
- [x] Create Stripe account and obtain API keys (publishable + secret) — keys in hand

---

## Payment Scenarios

### 1. Pre-Registration (Online, Before Camp Day)

Patient registers on the camp website, selects services, and pays in one flow.

- **Integration:** Stripe Payment Element embedded in the registration form
- **Flow:** Patient selects services → live total shown → enters card details → Stripe processes payment → on success, registration is confirmed and QR code confirmation email is sent
- **Rule:** Registration is not confirmed until payment clears. No pending/pay-later registrations.
- **Free services:** First consultation is $0 — handled as a $0 Stripe PaymentIntent; patient still completes the flow so a record is created

### 2. Walk-In (Day-Of, At Registration Desk)

Patient arrives without a pre-registration.

- **Integration:** Tap to Pay on volunteer's phone (NFC) or cash
- **Flow:** Volunteer enters patient info on tablet → selects services → total shown → patient pays (card tap or cash) → volunteer confirms payment → badge printed immediately
- **Hardware:** Volunteer's NFC-enabled phone for card; no hardware needed for cash

### 3. Doctor Add-On (Mid-Visit)

Doctor recommends an additional service the patient did not pre-pay for.

- **Flow:**
  1. Doctor flags "Add Service" on their station tablet
  2. Patient's record is marked `needs_payment`
  3. Registration desk receives an alert
  4. Volunteer escorts patient back to registration desk
  5. Patient pays via Tap to Pay or cash
  6. Payment confirmed → service added to patient's record → patient routed to the new station
- **Rule:** Patient does not proceed to the new station until payment is confirmed in the system

### 5. Payment Waiver (Override)

Certain authorized staff can waive payment for an individual service or an entire registration. This is a restricted action with a full audit trail.

**Authorization:** Waiver permission is a separate role flag assigned by the coordinator before camp — independent of till access. A volunteer may have a till but not waiver authority, or vice versa. Typically limited to the coordinator and 1–2 senior committee members.

**Flow:**
1. Authorized volunteer opens a registration or walk-in form
2. Taps "Waive Payment" on a specific service or the full total
3. System requires a **reason** before proceeding (dropdown + optional free text):
   - Financial hardship
   - Volunteer / staff member
   - Committee decision
   - Complimentary (sponsor/donor)
   - Other (free text required)
4. Waiver is recorded against the volunteer's ID, timestamp, and reason
5. Registration proceeds at $0 for the waived amount
6. For non-waiver volunteers: the "Waive Payment" option is not visible — it does not appear on their screen at all

**Waiver log (coordinator dashboard):**
- All waivers during the event listed in real time
- Columns: attendee name, service(s) waived, original amount, waived by, reason, timestamp
- Included in post-camp reconciliation export as a separate section

**Partial waivers:** A single service can be waived while others are paid normally. The remaining balance is collected via Stripe or cash as usual.

---

### 4. Cash Payments

Cash is accepted only by volunteers assigned a **till** before camp. The till is the physical control — if you have the till, you take cash.

- **Till assignment:** Coordinator assigns till holders in the system before camp day. Typically 1–2 volunteers at the registration desk and 1 at the POS merchandise station.
- **Cash option visibility:** Volunteers with a till see both Stripe and cash as payment options. Volunteers without a till see Stripe only — cash is hidden from their screen. If a card-only volunteer is approached for cash, the screen prompts: "For cash payment, please visit the till desk."
- **Flow:** Till volunteer selects "Cash" → enters amount tendered → system shows change due → volunteer collects cash and confirms → registration/sale proceeds
- **No cash online:** Pre-registration and membership are card-only (Stripe). Cash is day-of only.
- **Reconciliation:** Each till holder's cash is tracked separately — total collected, number of transactions, timestamps. End-of-day: till holder counts physical cash and reconciles against the system total.

---

## Why the Current Setup Breaks

Today, Google Forms (registration) and Square (payment) are completely separate systems with no shared identifier. The failure modes:

| Failure | Cause |
|---|---|
| Patient paid but not in the form | Paid via Square link, forgot to fill the form, or filled it under a different name |
| Patient in the form but not paid | Filled the form, intended to pay at the door |
| Revenue vs. headcount mismatch | Manual reconciliation after the camp takes hours and still has errors |

The new system fixes this by making Stripe checkout the last step of the registration form — one flow, one record, one ID.

---

## Service Pricing

Configured in the system admin panel — can be updated per camp without a code change.

| Service | Price |
|---|---|
| First consultation | Free |
| Additional consultation | $5 |
| Blood test | $8–$15 (set per test type) |
| Ultrasound | $40 |
| X-ray | $40 |
| Vitamin B12 shot | $10 |
| Vitamin D shot | $10 |
| Blood bank | TBD |

---

## Payment Methods by Module

| Module | Methods accepted |
|---|---|
| Event pre-registration (online) | Stripe (card only) |
| Walk-in registration (day-of) | Stripe Tap to Pay, cash |
| Doctor add-ons (day-of) | Stripe Tap to Pay, cash |
| Event tickets (day-of, at door) | Stripe Tap to Pay, cash |
| POS / merchandise (day-of) | Stripe Tap to Pay, cash |
| Membership (online) | Stripe (card only) |
| Vendor registration | Zelle |
| Sponsorship | Zelle, check |

---

## Reconciliation

Post-camp, the coordinator dashboard exports a payment reconciliation report:

| Column | Source |
|---|---|
| Record ID | System |
| Patient / customer name | Registration record |
| Services / items | Registration or POS record |
| Amount | Transaction record |
| Payment method | Stripe / cash / Zelle / check |
| Payment time | System timestamp |
| Add-ons | Station visit records |
| Volunteer who processed | Staff ID (cash transactions) |

Cash transactions are totalled separately so the volunteer can reconcile the physical cash at end of day. Stripe transactions reconcile automatically via the Stripe dashboard.

---

## Square Account Setup Required

Before going live, confirm the following with the Square account holder:

- [ ] Square Web Payments SDK application ID and location ID (for online checkout)
- [ ] Square Terminal paired and assigned to the registration desk location
- [ ] Square Sandbox credentials available for development and testing
- [ ] Webhook endpoint configured in Square Developer Dashboard (for payment confirmation callbacks)
- [ ] Camp-specific item catalog set up in Square (optional — system can manage pricing independently)
