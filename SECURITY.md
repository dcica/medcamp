# Security Policy

The dcica platform handles registrations, payments, and personal contact details for non-profit events across multiple tenant organizations. We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Email **security@dcica.org** (or, until that is live, **sachin@buzzclan.com**) with:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- Affected component, version, or commit if known

We aim to acknowledge reports within **3 business days** and to provide a remediation timeline after initial assessment. Please give us a reasonable window to fix the issue before any public disclosure.

## Scope — what we care about most

Given the platform's design, these classes of issue are especially important:

- **Cross-tenant data access** — any path that reads or writes another organization's data, or bypasses Postgres Row-Level Security. This is our highest-severity category.
- **Authentication / authorization flaws** — OIDC misconfiguration, session handling, or RBAC checks that grant a role beyond its tenant scope.
- **Payment integrity** — anything affecting Stripe Connect flows, webhook verification, or tenant fund routing.
- **PII exposure** — leakage of registrant/attendee contact details. Note: the platform stores **no PHI/HIT** by design — if you find clinical data being stored, that is itself a reportable defect.
- **Secret exposure** — credentials committed to the repo or leaked at runtime.

## Out of scope

- Vulnerabilities in third-party dependencies that are already publicly known and pending an upstream fix (report upstream; tell us if we're not yet patched).
- Findings that require physical access to a volunteer's unlocked device.
- Self-hosting misconfigurations outside the default deployment (e.g., a deployer disabling RLS).

## Disclosure

We will credit reporters who follow this policy, unless you prefer to remain anonymous.
