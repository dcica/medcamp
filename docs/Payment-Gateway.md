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

**Open — leaning Stripe.** In-person payments use Tap to Pay on a phone (NFC) for all three options — no terminal hardware is owned or needed, so there is no switching cost from Square. Stripe offers the best developer SDK for a custom Next.js build and the best non-profit rate once 501(c)(3) status is verified.

**Action items:**
- [ ] Confirm 501(c)(3) registration status — required to unlock Stripe and PayPal non-profit rates
- [ ] Apply for Stripe non-profit rate: stripe.com/docs/tax-exempt
- [ ] Committee to make final call: Square (familiar) vs. Stripe (better SDK + non-profit rate)

---

## Payment Scenarios

### 1. Pre-Registration (Online, Before Camp Day)

Patient registers on the camp website, selects services, and pays in one flow.

- **Integration:** Square Web Payments SDK embedded in the registration form
- **Flow:** Patient selects services → live total shown → enters card details → Square processes payment → on success, registration is confirmed and QR code confirmation email is sent
- **Rule:** Registration is not confirmed until payment clears. No pending/pay-later registrations.
- **Free services:** First consultation is $0 — Square checkout handles $0 transactions; patient still completes the checkout flow so a record is created

### 2. Walk-In (Day-Of, At Registration Desk)

Patient arrives without a pre-registration.

- **Integration:** Tap to Pay on volunteer's phone (NFC) — no terminal hardware needed
- **Flow:** Volunteer enters patient info on tablet → selects services → patient taps/swipes on Square Terminal → payment clears → badge printed immediately
- **Hardware:** Square Terminal already owned; Square Reader on phone as backup

### 3. Doctor Add-On (Mid-Visit)

Doctor recommends an additional service the patient did not pre-pay for.

- **Flow:**
  1. Doctor flags "Add Service" on their station tablet
  2. Patient's record is marked `needs_payment`
  3. Registration desk receives an alert
  4. Volunteer escorts patient back to registration desk
  5. Patient pays via Square Terminal for the added service
  6. Payment clears → service added to patient's record → patient routed to the new station
- **Rule:** Patient does not proceed to the new station until payment is confirmed in the system

---

## Why the Current Setup Breaks

Today, Google Forms (registration) and Square (payment) are completely separate systems with no shared identifier. The failure modes:

| Failure | Cause |
|---|---|
| Patient paid but not in the form | Paid via Square link, forgot to fill the form, or filled it under a different name |
| Patient in the form but not paid | Filled the form, intended to pay at the door |
| Revenue vs. headcount mismatch | Manual reconciliation after the camp takes hours and still has errors |

The new system fixes this by making Square checkout the last step of the registration form — one flow, one record, one ID.

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

## Reconciliation

Post-camp, the coordinator dashboard exports a payment reconciliation report:

| Column | Source |
|---|---|
| Camp ID | System |
| Patient name | Registration record |
| Services paid | Registration record |
| Amount | Square transaction |
| Payment method | Square (online / terminal) |
| Payment time | Square |
| Add-ons | Station visit records |

This replaces the manual cross-check between Google Forms export and Square dashboard.

---

## Square Account Setup Required

Before going live, confirm the following with the Square account holder:

- [ ] Square Web Payments SDK application ID and location ID (for online checkout)
- [ ] Square Terminal paired and assigned to the registration desk location
- [ ] Square Sandbox credentials available for development and testing
- [ ] Webhook endpoint configured in Square Developer Dashboard (for payment confirmation callbacks)
- [ ] Camp-specific item catalog set up in Square (optional — system can manage pricing independently)
