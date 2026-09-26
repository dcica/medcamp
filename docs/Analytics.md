---
title: Analytics
nav_order: 11
---

# Analytics — GA4 Configuration

**Audience:** whoever administers the tenant's Google Analytics property, and any
self-hoster deciding whether to turn analytics on at all. This is an operations
document. What visitors are told is in the
[Privacy Policy](Privacy-Policy.md#analytics-and-cookies), and the two must stay
in agreement — if you change what is sent, change that section in the same pull
request.

---

## What this is for, and what it is not

**GA4 is not the source of truth for money. The reconciliation export is.**

The two numbers will never match, and the gap is structural rather than a bug to
be hunted:

- **Ad blockers and privacy browsers** drop the client-side tag entirely. A
  double-digit share of visits is normal.
- **A closed tab** kills a client-side event mid-flight.
- **Cash never had a browser.** A walk-in paying at the registration desk has no
  web session, so no purchase event is sent for them at all — by design, see
  *deliberately not measured* below. At the modelled 80/20 online/walk-in split
  that is roughly a fifth of camp revenue that GA4 will never see.
- **EEA / UK / CH visitors default to consent denied**, so nothing is recorded
  for them unless consent is given.
- **Refunds and payment overrides** are settled in the platform's own records.
- **Google's own processing** — session windows, its 14-month retention ceiling,
  reporting thresholds — is not accounting.

So: **GA4 revenue is always lower than Stripe, and that is the correct
behaviour.** Anyone comparing the two as a reconciliation check is using the
wrong tool and will keep raising the same false alarm. Write it on the report if
you have to.

What GA4 is for is the one question reconciliation genuinely cannot answer:
**where did the ticket buyer come from.** The reconciliation export knows the
sale happened, the amount, the method, and who processed it. It has no idea
whether that person came from a WhatsApp forward, a Google search for the event
name, the temple noticeboard, or last month's email. GA4 answers that, and
tolerating an imprecise revenue figure is the price of the answer.

Treat GA4 revenue as **relative**: channel A produced roughly three times what
channel B did. Never as **absolute**.

---

## Default off, and why that matters

No measurement id configured means **no tag, no cookies, and nothing sent** —
not a disabled tag, not a tag in a debug mode. `src/app/_components/Analytics.tsx`
returns `null` and the document contains no analytics script at all.

This is what makes the Privacy Policy's conditional wording ("only active when
the organization has configured its own GA property") true rather than
aspirational, and it is why local development and CI generate no traffic. A
self-hoster who never sets the id has, correctly, no analytics.

The id is shape-validated against `GA_MEASUREMENT_ID_RE` in `src/lib/env.ts`
before it can reach the page. A malformed value fails the schema, arrives as
`undefined`, and the site renders with no tag rather than with a broken — or
hostile — inline script. See *Multi-tenant seam* below for why that check is
load-bearing and not cosmetic.

---

## Account configuration checklist

In dependency order. Steps 1 and 2 are worth more than everything after them,
and step 1 is worth more than everything else combined.

### 1. Exclude `checkout.stripe.com` as a referrer

**Admin → Data streams → (the web stream) → Configure tag settings → Show more
→ List unwanted referrals** → add `checkout.stripe.com`.

Do this before you look at a single report, because until it is done every
acquisition number in the property is wrong in a specific and misleading way.

The site uses Stripe **hosted** Checkout: the buyer leaves the site for
`checkout.stripe.com`, pays, and comes back to `/confirm/…`. To GA4 that return
is an inbound visit from a third-party domain. It **ends the session that was
doing the buying and opens a fresh one** attributed to
`checkout.stripe.com / referral`. The consequences compound:

- Stripe gets credit for **every single sale**. It becomes your best-performing
  "channel," which is meaningless — it is your own payment page.
- The channel that actually produced the sale — the search, the email, the
  social post — is left holding a session that ends at checkout, so it looks
  like it **bounced**. You will conclude that your working channels do not
  convert.
- Session and user counts inflate, because one buyer is counted as two visits.

An unwanted-referral entry tells GA4 to ignore that referrer and keep the
original session and its attribution intact.

**Cross-domain measurement is the wrong tool here.** It works by tagging links
between two domains you control and requires the GA tag to run on both ends. You
cannot put a tag on Stripe's checkout domain. Do not try to solve this with a
cross-domain configuration; the unwanted-referral list is the mechanism for a
payment redirect through a domain you do not own.

### 2. Data retention → 14 months

**Admin → Data settings → Data retention → Event data retention → 14 months.**

Fourteen months is the maximum a standard (non-360) property allows. The default
is **2 months**.

**It is not retroactive.** Data already aged out is gone; changing the setting
only protects what arrives afterwards. That makes this an early task, not a
someday task — every week it stays at the default is a week you will not have
later.

Two months is actively wrong for this organization, whose calendar is annual:
Navratri, Diwali, the winter and summer camps. The question you will always want
to ask is *how does this year's Navratri compare with last year's* — and at the
default setting the answer is unavailable, permanently, because last year's data
was deleted ten months before you asked. Fourteen months exists precisely so a
year-over-year comparison plus a reporting buffer fits inside it.

### 3. Turn on the BigQuery export

**Admin → Product links → BigQuery links → Link.**

Free at this volume, and the **only** way to hold event-level data beyond the
14-month ceiling. The export writes daily; once it runs, retention stops being a
hard deletion of your history and becomes a limit on what the GA4 UI can query.
Anything longitudinal — three years of camp attendance by channel — has to come
from here.

Set it up before you need it. It is not retroactive either: it exports from the
day it is linked forward.

### 4. Link Search Console

**Admin → Product links → Search Console links → Link**, then publish the
Search Console report collection under **Reports → Library**.

This pairs with the sitemap and the per-event pages that already ship, and it is
the only way to see the actual search queries that reached an event page — GA4
alone shows you `google / organic` and stops there. For an organization whose
discovery is largely "someone searched for the event by name," the query list is
the interesting half of the funnel.

The property must already be verified in Search Console. This deployment
supports HTML-tag verification via `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, or
you can verify by DNS TXT record instead.

### 5. Leave Google Signals OFF; reporting identity device-based

- **Admin → Data settings → Data collection → Google signals data collection** —
  leave off.
- **Admin → Data display → Reporting identity → Device-based.**

Signals is tempting because it promises cross-device users and demographics. At
this audience size it does more harm than good.

Signals brings **threshold-based suppression**: when a report could allow a
single individual to be identified from demographic or interest data, GA4
withholds the row entirely. With a few hundred people, that threshold is hit
constantly — you open a report and large parts of it are blank, with no
indication which parts. The demographic data you turned it on for is exactly the
data most often suppressed.

**Device-based identity keeps the numbers unmodelled.** They are counts of what
was actually collected, not blended or estimated figures. Unmodelled numbers can
be reconciled against the platform's own reports — a gap is then a real,
explainable gap (an ad blocker, a cash sale) rather than "Google's model
disagrees with our database and neither of us can say why." Given that this
property's job is attribution and not audience profiling, cross-device
resolution buys little and costs the ability to trust a number.

Signals also enables advertising features this organization does not use. The
tag already denies every advertising signal by default; leaving Signals off keeps
the property consistent with that posture and with what the Privacy Policy says.

### 6. Define internal traffic, then set the filter to **Active**

Two separate places, and skipping the second is the usual mistake:

1. **Admin → Data streams → (web stream) → Configure tag settings → Show all →
   Define internal traffic** — add the venue and office IP ranges. This tags
   matching traffic as `traffic_type = internal`. It does not exclude anything.
2. **Admin → Data settings → Data filters → Internal Traffic** — set state to
   **Active**.

**A data filter ships in Testing mode, and Testing mode does nothing** except
let you view the traffic as a segment. Leaving it there is the single most common
reason a correctly-defined internal filter has no effect.

**An active exclusion filter drops that data permanently** — it is not stored and
excluded from reports, it is never written. Get the IP ranges right first,
confirm in Testing mode that the segment contains what you expect and nothing
else, then activate.

The tag is already suppressed on staff and day-of screens
(`STAFF_PATH_PREFIXES` in `src/app/_components/Analytics.tsx`), which handles the
big offender: forty volunteer phones reloading a queue for six hours. The IP
filter covers what remains — committee members browsing the public event pages
from the office, and QA clicking through a checkout from the venue.

### 7. Register the custom dimensions

**Admin → Data display → Custom definitions → Create custom dimension**, scope
**Event**, one each:

| Dimension name | Event parameter | What it is |
|---|---|---|
| Event slug | `event_slug` | Which event — the URL slug |
| Event kind | `event_kind` | `CAMP`, `GENERAL`, or `MEMBERSHIP_DRIVE` |
| Payment method | `payment_method` | `STRIPE`, `CASH`, `ZELLE`, `CHECK`, `COMP` |

**An unregistered event parameter is collected but invisible.** It arrives with
every event, sits in the raw data, and cannot be used as a dimension, a
breakdown, or a filter anywhere in the GA4 UI — reports simply behave as if it
were never sent. Nothing errors; you just cannot see it. (The BigQuery export is
the exception: raw parameters are all there regardless.)

Registration is **not retroactive** for reporting either: a dimension starts
populating from the day it is created. Register all three before the first event
you care about measuring.

A standard property allows 50 event-scoped custom dimensions, so there is no
scarcity pressure here — but do not register parameters "just in case." Each one
is a thing someone has to understand later.

### 8. Mark the key events

**Admin → Data display → Events** → toggle *Mark as key event* on:

- `purchase`
- `sign_up`
- `generate_lead`

**Explicitly NOT `begin_checkout`.** It is a funnel step, not a goal. Marking it
as a key event means every report showing "conversions" counts an abandoned cart
alongside a completed sale, and the conversion rate becomes a number nobody can
interpret. `begin_checkout` earns its keep inside the funnel exploration in
step 9, where the drop-off from it to `purchase` is the entire point.

`view_item` is likewise a step, not a goal.

### 9. Build the two reports anyone will actually open

Everything above is plumbing. These two are the deliverable.

**A. Funnel exploration — event page → begin checkout → purchase.**
*Explore → Funnel exploration.* Three steps: `view_item` → `begin_checkout` →
`purchase`. Break down by the `event_slug` dimension from step 7.

This answers "we had traffic and no sales — where did they leave?" A big drop at
step 1 → 2 is a pricing or event-page problem. A big drop at step 2 → 3 is a
checkout problem, and worth acting on immediately.

**B. Traffic acquisition with revenue.**
*Reports → Acquisition → Traffic acquisition.* Primary dimension **Session
default channel group**; add total revenue and key-event columns.

This is the report that justifies the whole property: which channel produced
paid registrations. It is also the report that is meaningless until step 1 is
done, since without the unwanted-referral entry every row of revenue lands on
`checkout.stripe.com / referral`.

Add `event_slug` as a secondary dimension when the property carries more than
one event at a time — otherwise a large camp buries a small one.

### Along the way: the Measurement Protocol API secret

The server-side `purchase` event authenticates with a Measurement Protocol API
secret, created at **Admin → Data streams → (web stream) → Measurement Protocol
API secrets → Create**.

It is a **server-side credential**. It must live in a server-only environment
variable — never one prefixed `NEXT_PUBLIC_`, which would publish it to every
visitor's browser and let anyone write events into the property.

To confirm events are arriving, use **Admin → DebugView** with a test order.
Measurement Protocol has no error response worth reading: a malformed payload is
accepted with a 2xx and silently discarded, so "no error" is not evidence that
anything landed.

---

## What we deliberately do not measure

These are closed decisions. Each was closed for a reason recorded here so it does
not get reopened as an oversight. The convention is the one in
[Payment Gateway](Payment-Gateway.md): write down *why*, so a later reader
inherits the reasoning and not just the rule.

### No clinical service names — ever

A camp `purchase` event carries **one generic line item**, never the services
bought. `Vision Screening`, `Dental Check`, `Bloodwork` are never transmitted.

Two independent reasons, either one sufficient:

1. **The No-PHI mandate.** The platform's guarantee (CLAUDE.md; Platform Mandate
   §7) is that no health information is stored or exposed. A per-visitor record
   of which health services someone purchased, attached to a persistent
   analytics identifier held by an advertising company, is that information —
   the fact that it is a purchase record rather than a clinical note does not
   change what it reveals.
2. **Google prohibits it.** Sending health data to Google Analytics violates its
   own terms. A property doing it is at risk of being shut down, taking the
   legitimate attribution data with it.

Non-camp events do send item detail: a ticket tier, a merchandise item, a
membership term. None of that is health information and the distinction is the
carve-out, not an inconsistency.

**Do not "improve" the camp funnel by adding service-level `items`.** It is the
most natural-looking optimization in this whole document and it is the one thing
here that must not happen.

### No `user_id`

GA4 supports a `user_id` for stitching a person's sessions across devices. We do
not send one.

Tying a stable, cross-session identity to camp attendance is precisely the
correlation the No-PHI posture exists to prevent. Even with service names
redacted, a durable id that says *this same person attended the medical camp in
March and again in November* builds a health-adjacent profile inside an
advertising platform, one event at a time. The redaction in the previous decision
would be doing much less work if the identifier it hangs on were a person rather
than a browser.

Cost: no cross-device user counts, and campaign attribution ends at the browser.
Accepted.

### No purchase event for an order with no web session

The `purchase` event is sent **only** when a GA client id was captured from the
first-party `_ga` cookie during checkout and stored on the order. No client id,
no event.

A walk-in paying cash at the registration desk never had a browser session, so
there is nothing to attribute the sale to. Sending the event anyway would mean
inventing a session — GA4 would file it as `direct`, and `direct` revenue is
where you look for demand you have not explained yet. Poisoning that row with
day-of cash sales would send someone chasing web traffic that never existed.

Consequence, stated plainly so it is not rediscovered as a bug: **GA4 revenue
excludes all cash and day-of walk-in revenue.** That is a large and deliberate
gap. It is also the largest single reason GA4 and Stripe will not agree.

### No analytics on staff screens

The tag is not emitted on `/admin`, `/staff`, `/dashboard`, `/station`, `/gate`,
`/checkin`, `/badge`, `/volunteer/checkin`, or `/test-login`.

A camp puts roughly forty volunteer phones on venue WiFi refreshing queues for
six hours — more page views in one morning than the public site sees in a month,
from a handful of devices on one IP. Left tracked, every metric with sessions in
its denominator (conversion rate, bounce, average engagement) is wrecked in
exactly the week the tenant most wants to read it, and wrecked *invisibly*: the
numbers still look plausible.

There is also nothing to learn. Nobody optimizes a volunteer's route through the
gate screen from an analytics report; they watch the queue.

The prefix list lives in one place, `STAFF_PATH_PREFIXES`, and matching is on a
path-segment boundary rather than a bare `startsWith` — `/volunteer/checkin` is a
staff screen while `/volunteer` (the signup form) and `/volunteers` (the public
roster) are public funnel pages that must stay measured.

### No Google Signals

See step 5. Threshold-based suppression blanks a large share of reports at this
audience size, device-based identity keeps the numbers unmodelled and therefore
reconcilable, and Signals switches on advertising features that contradict both
the tag's consent defaults and the Privacy Policy.

---

## Multi-tenant and self-hosting notes

**Analytics is default-off and per-tenant.** There is no platform-wide
measurement id and there must never be one — a hardcoded id would ship one
organization's analytics property to every self-hoster and silently collect a
stranger's traffic into it.

For a self-hoster: leave `NEXT_PUBLIC_GA_MEASUREMENT_ID` unset and there is
nothing to configure, nothing to disclose, and no cookie banner question to
answer. Everything in this document is optional.

### The known seam

Today the measurement id is a **per-deployment environment variable**. That is
correct for a single-tenant reference deployment and wrong for hosted
multi-tenancy, where one deployment serves many organizations and each needs its
own property.

When a second tenant arrives, the id moves into `Organization.settings` — the
same place branding lives. **When it moves, it must be re-validated at render
time, immediately before interpolation**, exactly as the branding colours are:

- `Organization.settings` is arbitrary JSON. The write path that put a value
  there is not guaranteed to be the one in this repository.
- The measurement id is interpolated into an **inline `<script>`** (gtag needs
  the id inside the snippet, not merely in a URL). An unvalidated value there is
  not a broken style rule — it is **arbitrary JavaScript execution on every
  page**.

Copy the pattern in `src/lib/branding.ts`: `brandingStyleVars()` re-applies
`isBrandHex` per value even though `themeSchema` already validated it on write,
because that function is the last thing between database JSON and the DOM, and a
value that fails is **dropped rather than emitted**. The analytics equivalent is
to re-apply `GA_MEASUREMENT_ID_RE` (`src/lib/env.ts`) at render and emit no tag
at all when it fails. Validating only on write is not sufficient; the write path
is not the trust boundary.

---

## Environment warning — the two keys are not the same switch

`SEARCH_INDEXING=off` keeps crawlers off a working-copy deployment. **There is no
equivalent guard on analytics.** The tag is emitted wherever a valid measurement id
is configured, with no notion of which environment it is running in.

This looks like it should be fixed by unsetting the measurement id outside
production. It should not be, and that question is already settled: `test.dcica.org`
carries the **same** property as prod, decided 2026-08-23, because it is a
real-traffic storefront rather than a scratch environment — its visitors are real
people buying real tickets, so its visits belong in the numbers. The recorded
rationale also names the cost of the alternative: an unset id means the inline
snippet is never exercised anywhere before production, so the first real test of the
tag would be the live site. Staff and QA traffic on that host is split out in GA with
a hostname filter. Do not reopen this by unsetting `NEXT_PUBLIC_GA_MEASUREMENT_ID`.

**Server-side `purchase` events are a different switch, and they do not inherit that
reasoning.** A page view from a test host carries a hostname, so it can be segmented
out afterwards. A Measurement Protocol payload carries only what the sender puts in
it and no browser context — so test-mode Stripe revenue would land in the property of
record with **no dimension to filter it by**, indistinguishable from a real sale. A
GA4 property cannot have a subset of its events deleted after the fact, so there is
no cleanup path either.

**The rule, therefore: `NEXT_PUBLIC_GA_MEASUREMENT_ID` stays set everywhere it is set
today; `GA_API_SECRET` is set in the production scope only.**

That outcome falls out of how the sender is gated rather than having to be
remembered: it no-ops silently unless BOTH the measurement id and the API secret are
present, so a deployment without the secret sends no server-side events at all. Test
keeps contributing page views and keeps exercising the snippet, exactly as decided in
August; no test-mode order ever reaches the property. Nothing has to be configured to
get this — the secret simply is not added outside production.

Validate a server-side payload with GA4's Measurement Protocol **validation
endpoint**, or with DebugView, never by pointing a test deployment at the live
property. This matters more than it sounds: the real collect endpoint answers a
malformed payload with a 2xx and silently drops it, so "it returned 204" is not
evidence that anything was recorded.

> **If a tenant ever does need its own separate property**, the seam is the one
> described in the section above — measurement id and API secret both move into
> `Organization.settings`, and this gating rule survives unchanged.

---

## Cross-references

| Topic | Where |
|---|---|
| What visitors are told | [Privacy Policy → Analytics and Cookies](Privacy-Policy.md#analytics-and-cookies) |
| Multi-tenant and per-tenant configuration posture | [Platform Mandate](Platform-Mandate.md) §1, §6 |
| Reconciliation export — the actual source of truth for money | [Payment Gateway → Reconciliation](Payment-Gateway.md#reconciliation) |
| Tag emission, staff suppression, URL scrubbing, consent defaults | `src/app/_components/Analytics.tsx` |
| Measurement id validation | `src/lib/env.ts` (`GA_MEASUREMENT_ID_RE`) |
| Render-time re-validation pattern to copy for the multi-tenant seam | `src/lib/branding.ts` (`brandingStyleVars`) |
