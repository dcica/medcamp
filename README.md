# MedCamp

Automation system for non-profit medical camps — registration, payments, patient routing, supply management, and day-of coordination.

## Documentation

Full documentation site: [docs home](docs/index.md)

- [System Overview & Committee Review](docs/MedCamp-System-Overview.md) — architecture, modules, venue configurations, build plan, and open questions for the committee
- [Design System](docs/Design-System.md) — visual language: color/type/spacing tokens, the Care Spine motif, and component anatomy (progress report sheet, queue card, camp page)
- [Hardware Recommendations](docs/Hardware-Recommendations.md) — color + label printers, tablets, QR scanners, WiFi, displays, and budget estimate
- [Payment Gateway](docs/Payment-Gateway.md) — Stripe integration, payment scenarios, pricing, and reconciliation
- [Platform Extensions](docs/Platform-Extensions.md) — general events, membership, POS/merchandise, vendor registration (with Zelle)

## Project Structure

```
docs/    — planning documents, specs, committee materials
src/     — application code (coming soon)
```

## Background

We run medical camps serving 300–500 patients in a half-day session, offering specialist consultations, blood draw, imaging, and more. This system replaces disconnected Google Forms + Square workflows with a unified registration-to-discharge platform.

For questions: sachin@buzzclan.com
