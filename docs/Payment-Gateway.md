---
title: Payment Gateway
nav_order: 7
---

# Payment Gateway

## Platform Decision

Three options were evaluated. Square is the current working platform, but Stripe was selected for the new build — its non-profit tier offers savings at scale, and its SDK is the best fit for a custom Next.js application with both online checkout and Tap to Pay.

### Comparison

| | Square | PayPal | Stripe |
|---|---|---|---|
| **Online rate (standard)** | 2.9% + $0.30 | 2.99% + $0.49 | 2.9% + $0.30 |
| **In-person rate (standard)** | 2.6% + $0.10 | 2.29% + $0.09 | 2.7% + $0.05 |
| **Non-profit rate** | No dedicated tier | 1.99% + $0.49 (donations only) | 2.2% + $0.30 — **dcica ineligible**, see below |
| **In-person method** | Tap to Pay on phone (NFC) | Tap to Pay on phone (NFC) | Tap to Pay on phone (NFC) |
| **Hardware required** | None — phone only | None — phone only | None — phone only |
| **Already in use** | Yes | No | No |
| **Developer SDK quality** | Good | Dated | Excellent |
| **Non-profit application** | N/A | paypal.com/us/webapps/mpp/givingfund | Support contact form — requires >80% donation volume |

### Savings at Camp Scale

At 300 patients averaging $25/patient = $7,500 per camp:

| Provider | Rate | Fee per camp |
|---|---|---|
| Square (standard, online) | 2.9% + $0.30 | ~$308 |
| Stripe (standard, online) | 2.9% + $0.30 | ~$308 |
| Square in-person only | 2.6% + $0.10 | ~$225 |
| Stripe in-person only | 2.7% + $0.05 | ~$218 |
| ~~Stripe non-profit~~ | ~~2.2% + $0.30~~ | **unavailable — see below** |

At the actual 80/20 online/walk-in split, Stripe standard blends to **~$290/camp**
(~$246 across 240 online transactions, ~$44 across 60 in-person). Provider choice
moves this by tens of dollars per camp; it is not where the money is.

**The non-profit rate is not achievable and must not be planned around.** Stripe
requires that **at least 80% of payment volume be tax-deductible donations**, and
explicitly excludes **ticket sales, membership fees, registration fees, tuition,
and auction payments** from that threshold. dcica's Stripe volume is
approximately **<10% donations** — camp service fees, event tickets, memberships,
vendor registration, and merchandise are the business. Donations are an optional
order-level add-on (`LineItem.isDonation`), not the revenue base.

Verified 2026-08-20 against Stripe's own support documentation, and confirmed
empirically: a $5.00 live charge settled at a $0.45 fee, i.e. 2.9% + 30c.
Account configuration is not the cause — `business_type` is already `non_profit`
and the MCC is already 8398. Revenue mix is the disqualifier, and no application
or follow-up changes that.

**The real lever is passing the fee to the payer**, not the rate. An optional
"cover the processing fee" checkbox at checkout applies to 100% of volume rather
than the <10% that is donations, and recovers roughly **$290/camp** versus the
~$53/camp the non-profit rate would have saved. Standard practice for non-profit
checkouts and entirely within our control.

### Decision

**Stripe — confirmed**, but on SDK quality and in-person rates, **not** on the
non-profit rate. The organization is a registered 501(c)(3), yet that does not
qualify it for Stripe's discounted rate (see above). Stripe still wins: best
in-person rate of the three (2.7% + $0.05), no terminal hardware to buy since
walk-ins use Tap to Pay on a volunteer's phone, and the strongest SDK for a
custom Next.js build. Budget at **standard rates — 2.9% + $0.30 online.**

**Action items:**
- [x] 501(c)(3) status — confirmed
- [x] Stripe non-profit rate — **investigated and closed 2026-08-20: ineligible.**
      Requires >80% tax-deductible donation volume; dcica is <10%. Do not reopen.
- [ ] Decide on an optional "cover the processing fee" checkbox at checkout —
      the actual cost lever (~$290/camp vs. ~$53/camp for the rate)
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

### 5. Payment Override

Certain authorized staff can waive payment for an individual service or an entire registration. This is a restricted action with a full audit trail.

**Authorization:** Override permission is a separate role flag assigned by the coordinator before camp — independent of till access. A volunteer may have a till but not override authority, or vice versa. Typically limited to the coordinator and 1–2 senior committee members.

**Flow:**
1. Authorized volunteer opens a registration or walk-in form
2. Taps "Override Payment" on a specific service or the full total
3. System requires a **reason** before proceeding (dropdown + optional free text):
   - Financial hardship
   - Volunteer / staff member
   - Committee decision
   - Complimentary (sponsor/donor)
   - Other (free text required)
4. Override is recorded against the volunteer's ID, timestamp, and reason
5. Registration proceeds at $0 for the overridden amount
6. For non-override volunteers: the "Override Payment" option is not visible — it does not appear on their screen at all

**Override log (coordinator dashboard):**
- All payment overrides during the event listed in real time
- Columns: attendee name, service(s) overridden, original amount, overridden by, reason, timestamp
- Included in post-camp reconciliation export as a separate section

**Partial overrides:** A single service can be overridden while others are paid normally. The remaining balance is collected via Stripe or cash as usual.

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

## Stripe Account Setup Required

Before going live, confirm the following on the Stripe account:

- [x] Publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and secret key (`STRIPE_SECRET_KEY`) obtained — test keys in hand
- [x] Stripe non-profit rate — ineligible (<10% donation volume vs. >80% required). Closed 2026-08-20; budget standard rates.
- [ ] Tap to Pay on phone enabled on the Stripe account (for in-person walk-in and add-on payments)
- [ ] Webhook endpoint configured in the Stripe Dashboard (for payment confirmation callbacks)
- [ ] Swap test keys for live keys in Vercel environment variables at deploy time
