<div align="center">

# MedCamp

### Open-source event management for non-profits — from online registration to day-of coordination, on a phone.

Run a 300–500 patient medical camp (or any community event) without the Google Forms + Square + paper duct-tape. Unified registration, payments, QR check-in, live patient routing, supply planning, and reconciliation — multi-tenant and self-hostable.

[Demo](#-quick-start) · [Documentation](docs/index.md) · [Platform Mandate](docs/Platform-Mandate.md) · [Contributing](CONTRIBUTING.md)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
![Status: pre-development](https://img.shields.io/badge/status-pre--development-orange.svg)
![Built with Next.js](https://img.shields.io/badge/Next.js-App_Router-black.svg)

</div>

<!--
  📸 SCREENSHOT / GIF GOES HERE once the MVP is runnable.
  Lead with the phone-first check-in flow — it's the most recognizable, sharable shot.
  e.g. ![MedCamp check-in on a phone](docs/assets/checkin-demo.gif)
-->

---

## What it replaces

Our camps grew to 300–500 patients in a single half-day. The stack that got us there — **Google Forms** for registration, **Square** for payment, **paper tripart forms** for walk-ins, and volunteers **verbally herding** patients between stations — hit its ceiling. The problem was never staffing; it was the lack of a coordinating system.

MedCamp is that system: one flow from pre-registration to post-camp reconciliation, designed around how camps actually run.

## How it works

```
Registration → Check-In (QR scan) → Vitals → Doctor Consult → [labs / imaging] → Discharge
```

- **80%** pre-register and pay online; **20%** walk in (tablet form + Stripe Tap to Pay on-site)
- Every patient gets a printed progress report sheet: QR code + color-coded service dots + checklist
- Doctors can add services mid-visit → patient is flagged for payment → routed to the next station
- The coordinator sees queue depths, payment status, and bottlenecks in real time

## Features

| | |
|---|---|
| 🧾 **Unified registration + payment** | One form, live pricing, group/family checkout, capacity caps per service |
| 📲 **QR check-in & badge** | Scan-to-check-in, digital waiver, instant label/badge print |
| 🚦 **Station routing** | Per-station queues, add-on payment alerts, no more verbal herding |
| 📊 **Coordinator dashboard** | Real-time queue depths, payment status, bottleneck alerts, reconciliation export |
| 📦 **Supply calculator** | Procurement list generated from registered service counts |
| 🧪 **Lab tracking** | Staff marks received/mailed, prints address labels — **no clinical results stored** |
| 🎟️ **Beyond camps** | General events, membership, onsite POS, vendor & sponsor registration, volunteers |

## Why it's different

- **📱 Phone-first.** Every volunteer screen works on a 6" phone — 48px tap targets, single-column, no pinch-zoom. Tablets are an enhancement, never a requirement.
- **🏢 Multi-tenant.** Any non-profit can run it. `Organization` is the tenant root; data is isolated at the database via Postgres Row-Level Security.
- **🔒 No PHI, by design.** Patient records are camp-scoped (name, phone, paid services) and purged after each event. No diagnoses, lab results, or insurance data — ever.
- **🧩 No lock-in.** Pluggable auth (OIDC), email, payments (Stripe Connect), and Postgres. Configure per-tenant branding and modules without forking.
- **🆓 Open-core.** Free and self-hostable; the hosted version is free or at-cost for verified 501(c)(3)s.

See the [Platform Mandate](docs/Platform-Mandate.md) for the full architecture stance.

## 🚀 Quick start

> **Status: in development.** The app (`src/`) is being built toward the winter 2026 camp. Deploying to Vercel + Supabase across test / staging / prod is documented in the **[Deployment runbook](docs/Deployment.md)**.

When the MVP ships, getting started will be:

```bash
git clone https://github.com/dcica/medcamp.git
cd medcamp
cp .env.example .env   # fill in Supabase, OIDC, and Stripe Connect values
# install + run instructions land with the first release
```

Configuration is documented in [`.env.example`](.env.example) (Supabase/Postgres, NextAuth OIDC, Stripe Connect, pluggable email).

## 📚 Documentation

Full site: **[docs home](docs/index.md)**

| Document | What's inside |
|---|---|
| [Platform Mandate](docs/Platform-Mandate.md) | Open-source, multi-tenant, OAuth-first, Stripe Connect, self-hostable — overrides single-org assumptions |
| [System Overview](docs/MedCamp-System-Overview.md) | Architecture, modules, venue configs, build plan, committee questions |
| [Platform Extensions](docs/Platform-Extensions.md) | General events, membership, POS, vendor & sponsor registration |
| [Volunteer Module](docs/Volunteer-Module.md) | Recruitment, signup, reminders, day-of sign in/out, certificates |
| [Design System](docs/Design-System.md) | Color/type/spacing tokens, the Care Spine motif, component anatomy |
| [Payment Gateway](docs/Payment-Gateway.md) | Stripe integration, payment scenarios, pricing, reconciliation |
| [Hardware Recommendations](docs/Hardware-Recommendations.md) | Printers, tablets, QR scanners, WiFi, displays, budget |
| [Deployment](docs/Deployment.md) | Vercel + Supabase across test / staging / prod — runbook, env matrix, smoke tests |

## 🛣️ Roadmap

Built in sequence so there's something working before each camp:

1. Registration portal + Stripe checkout
2. Check-in & badge print
3. Station queue & routing
4. Coordinator dashboard
5. Supply calculator + venue config
6. Lab tracking & patient portal
7. Platform extensions — events, membership, POS, vendors, sponsors, volunteers

## 🤝 Contributing

Contributions are welcome — especially from people who run non-profit events and know where the rough edges are. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Platform Mandate](docs/Platform-Mandate.md).

- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Security:** report vulnerabilities privately per [SECURITY.md](SECURITY.md) — never via a public issue
- **License:** [AGPL-3.0](LICENSE) — self-host freely; modifications run as a network service must be published

## 💬 Questions

Open a [discussion](https://github.com/dcica/medcamp/discussions) or email **sachin@buzzclan.com**.

<div align="center">

Built for non-profits, by people who run them.

</div>
