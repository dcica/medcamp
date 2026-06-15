# Payment Gateway

## Platform: Square

Square is already in use for the camp — the website has an existing Square integration and the team has Square phone app/terminal experience. The system builds on this rather than introducing a new payment processor.

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

- **Integration:** Square Terminal (standalone device) or Square POS on a phone/tablet
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
