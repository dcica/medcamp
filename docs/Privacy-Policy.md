---
title: Privacy & Data Use Policy
nav_order: 9
---

# Privacy & Data Use Policy

*Last updated: August 2026*

This policy applies to all registrations, memberships, vendor applications, sponsorships, and volunteer signups processed through the dcica platform.

---

## Who We Are

dcica is a registered 501(c)(3) non-profit organization. We organize medical camps, community events, and membership programs. Our platform is used to manage registrations, payments, and event logistics.

---

## What Data We Collect

### At Event Registration
- Full name
- Phone number
- Email address
- Mailing address
- Services selected and paid for
- Payment confirmation (processed by Stripe — we do not store card numbers)
- Marketing consent preference and timestamp
- Signed waiver (digital or paper)
- An analytics identifier from your browser, if website analytics is switched on for this organization and your browser accepted the cookie — see [Analytics and Cookies](#analytics-and-cookies)

### At Membership Signup
- Full name, phone, email, mailing address
- Membership plan and term
- Payment confirmation (Stripe)

### At Vendor / Sponsor Registration
- Business name, contact name, phone, email
- Vendor type or sponsor tier
- Payment status (Zelle or check — we do not store bank account details)

### At Volunteer Signup
- Full name, phone, email
- Age band (e.g. under 16 / 16–17 / 18+) — we do not store date of birth
- School or organization affiliation and sponsoring advisor (optional)
- Role preferences, skills, languages, emergency contact
- Hours served and certificate record
- **For minor volunteers:** parent/guardian name and consent signature

### What We Do NOT Collect
- Medical diagnoses, lab results, prescriptions, or clinical notes
- Social Security numbers or government IDs
- Insurance information
- Payment card numbers (handled entirely by Stripe)

**Doctor's notes go home with you.** During a medical camp, any notes or advice a clinician writes are recorded only on your paper **progress report sheet, which you keep**. dcica retains no copy — digital or paper. Our system records only your name, contact details, and the services you paid for, and purges those after the camp.

---

## How We Use Your Data

| Data | Purpose |
|---|---|
| Name, phone, email | Registration confirmation, QR on your progress report, mailing lab results, event communications |
| Mailing address | Address labels for mailing physical lab results |
| Services paid | Routing you to the right stations; printing your progress report sheet |
| Payment info | Confirming registration; reconciliation records |
| Marketing consent | If opted in: membership drives, event announcements, organization updates |
| Volunteer profile, hours, school affiliation | Scheduling, confirmation reminders, recognition, certificates, and per-school hour summaries; recruitment for future events |
| Analytics identifier | Connecting a completed registration back to the visit that produced it, so we can tell which outreach actually brings people to an event |

We do not sell, rent, or share your personal information with third parties for their marketing purposes.

---

## Marketing Communications

Marketing consent is **opt-in only**. You choose at registration whether to receive future communications from dcica.

If you opted in, we may contact you by email or phone about:
- Upcoming medical camps and community events
- Membership programs
- Organization news and fundraising drives

**To opt out at any time:** Email us at admin@dcica.org with the subject "Unsubscribe" and we will remove you from all marketing lists within 5 business days.

---

## Analytics and Cookies

This section spells out what our website measurement does. A one-line summary would not be accurate enough to be useful, and there is a real difference between how a medical camp and a general event are handled.

**Analytics is off unless the organization has switched it on.** The platform ships with no analytics account configured. When none is configured no analytics script loads, no analytics cookies are set, and nothing is sent anywhere at all. dcica's public event pages do use Google Analytics 4; another organization running this same software may not.

**When it is on, cookies are set in your browser.** Google Analytics sets first-party cookies to recognize a returning browser and group its page views into one visit. That identifier is a random value belonging to the browser. It is not your name, and Google is not given your name to attach to it.

### What is measured while you browse

Page views, the referring site or search that brought you here, approximate location derived from your IP address (city level), device and browser type, and which pages you moved between — including funnel steps such as opening an event page, starting a checkout, submitting a volunteer signup, or submitting a contact form. Those funnel events carry an amount, a currency, and which event you were looking at. They carry no item detail.

### What is measured when you complete a payment

**When an order is confirmed we send Google Analytics a purchase record.** It contains:

- the order identifier
- the order total, and the currency (USD)
- the payment method (card, cash, and so on)
- which event it was for, and what kind of event that is
- the analytics identifier from your browser, so the sale is credited to the visit that produced it
- **for non-camp events only:** what was bought — ticket tier names, merchandise items, or membership term

An order total and an order identifier are payment-adjacent information, and we would rather say so than describe this as "aggregate traffic measurement." It exists to answer a question our own payment records cannot: which channel — a flyer, a search result, a social post, an email — actually produced a paid registration.

### A medical camp is treated differently, on purpose

**For a medical camp the item detail is deliberately withheld.** The purchase record carries a single generic line in place of the services you bought. The names of clinical services — a vision screening, a dental check, bloodwork — are **never** transmitted to Google Analytics, or to any other outside system.

The reason is the point of the entire design. Attaching a list of health services a person purchased to a durable analytics identifier would create exactly the record this organization has committed never to hold, and it is prohibited by Google's own rules on health data besides. So a camp purchase is reported as a total, and nothing more.

### What is never sent to analytics, for any kind of event

- Your name, email address, phone number, or mailing address
- Any clinical or medical information, including the names of services purchased at a medical camp
- Your card number or any payment credential — those go only to Stripe
- Your waiver, or anything you typed into a form field
- A durable account identifier. We do not send a user ID to analytics, so visits are not stitched into one named person's history across events.
- Advertising signals. Ad storage, ad personalization, and ad user data are set to denied everywhere by default, and Google's cross-device advertising features are left switched off. We do not use analytics data to target advertising.

### If you are in the EEA, the UK, or Switzerland

For visitors in those regions both analytics and advertising storage default to **denied**. Nothing is stored in your browser and no measurement is recorded unless and until consent is given.

### Staff screens are not measured

The analytics tag is suppressed entirely on the screens volunteers and staff use — the admin area, station queues, the gate and check-in screens, badge printing, dashboards, and volunteer check-in. Day-of operations are not tracked.

### Payment links and codes are scrubbed

The page address reported to analytics has the Stripe checkout session identifier and any per-person confirmation code stripped out of it, including on the page you land on after paying. We do not want those sitting in an analytics report, or in any long-term export of one.

### Paid cash at the door?

Then there was no browser session and no analytics identifier, and **no purchase record is sent at all**. Walk-in and cash transactions exist only in our own records.

### How to opt out

Block cookies for this site in your browser, install Google's Analytics Opt-out Browser Add-on, or use any content blocker. Registration, payment, check-in, and lab-status lookup all work normally with analytics blocked. The only consequence is that we cannot tell where your visit came from.

---

## Data Retention

| Data type | Retention |
|---|---|
| Event registration records | Purged after each camp/event (name, contact, services, payment ref) |
| Marketing consent records | Retained while consent is active; deleted on opt-out |
| Membership records | Retained while membership is active + 1 year after expiry |
| Vendor / sponsor records | Retained for 3 years for financial record-keeping |
| Payment references (Stripe transaction IDs) | Retained for 7 years (tax/audit requirements) |
| Lab result mailing status | Purged after mailing confirmed |
| Analytics identifier stored on an order | Purged with the rest of the order record |
| Volunteer profiles (contact, hours, history) | Retained across events to support recruitment and recognition; deleted on request |
| Minor volunteer consent records | Retained 3 years (record of authorization), then purged; deleted sooner on parent/guardian request |

**No clinical or medical data is stored in our system at any time.**

**Analytics data held by Google is separate from the table above and outlives our purge.** Once a purchase record has been sent, the order identifier, the amount, and the browser identifier sit in the analytics property under Google's own retention settings — up to 14 months, and longer where the organization exports its analytics data to keep year-over-year comparisons. Purging a registration from our system does not reach into that copy, and we cannot delete one visitor from it, because it holds no name, email, or phone number to find you by. What can be deleted there is the whole dataset, not an individual. If that matters to you, opt out of analytics before you register.

---

## Data Security

- All data is transmitted over HTTPS (encrypted)
- Payments processed by Stripe — PCI-DSS compliant; we never see or store card details
- Access to the system is restricted to authorized committee members and volunteers via Google account login
- Volunteer access is scoped to their role — a station volunteer cannot see registration data
- Patient records are purged after each event

---

## Your Rights

You may request at any time:
- **Access:** A copy of the personal data we hold about you
- **Correction:** Update any incorrect information
- **Deletion:** Remove your data from our records (subject to legal retention requirements)
- **Opt-out:** Stop receiving marketing communications, or stop website analytics (see [Analytics and Cookies](#analytics-and-cookies))

To exercise any of these rights, contact: **admin@dcica.org**

---

## Third-Party Services

| Service | Purpose | Their Privacy Policy |
|---|---|---|
| Stripe | Payment processing | stripe.com/privacy |
| Google (OAuth) | Staff login | policies.google.com/privacy |
| Google (Address Validation) | Standardizing your mailing address so lab results reach you (optional; only the address you enter is sent, once) | policies.google.com/privacy |
| Google Analytics | Website traffic measurement (page views, referrers, device type) and completed-order measurement. Sets cookies in your browser. Receives an order identifier, order total, payment method, and which event the order was for — plus, for non-camp events only, the items purchased. **Never** receives your name, email, phone, address, card details, or the names of clinical services. Only active when the organization has configured its own GA property. Full detail in [Analytics and Cookies](#analytics-and-cookies) | policies.google.com/privacy |
| Vercel | Website hosting | vercel.com/legal/privacy-policy |

---

## Children

Our events are open to all ages. If a minor is registering, a parent or guardian must complete the registration and waiver on their behalf. We do not knowingly collect data directly from children under 13.

Many of our volunteers are students recruited through middle schools, high schools, and colleges. A minor volunteer's signup requires a parent or guardian consent signature before it is accepted. We collect only what is needed to schedule, supervise, and recognize the volunteer (name, contact, age band, school affiliation, hours) — no date of birth and no sensitive data. Parents or guardians may request access to or deletion of their child's volunteer record at any time via admin@dcica.org.

---

## Changes to This Policy

We may update this policy as the platform evolves. The "Last updated" date at the top of this page reflects the most recent revision. Significant changes will be communicated via email to active members and registered participants.

---

## Contact

**dcica**
admin@dcica.org

For privacy concerns or data requests, please use the subject line "Privacy Request" so your message is routed correctly.
