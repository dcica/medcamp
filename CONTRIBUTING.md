# Contributing to the dcica platform

Thanks for your interest in contributing. This is an open-source, multi-tenant SaaS for non-profit event management — dcica is the first tenant, but the platform is built for any non-profit to adopt or self-host. Contributions that keep it general, accessible, and safe for that audience are very welcome.

Please read the [Platform Mandate](docs/Platform-Mandate.md) first — it is the source of truth when a module spec and the multi-tenant model disagree.

## Ground rules

- **Multi-tenant by default.** Every domain record is scoped to an `org_id` and protected by Postgres Row-Level Security. Never write a query or feature that can read or write across tenants.
- **No PHI/HIT — ever.** Patient records stay camp-scoped (name, phone, paid services) and are purged after each event. Do not add fields for diagnoses, lab results, clinical notes, or insurance data.
- **Phone-first.** Every volunteer-facing screen must work on a 6" phone: 48px minimum tap targets, single-column queue/scan views, no horizontal scrolling.
- **Configuration over code.** Tenant-specific behavior (branding, enabled modules, service menus, caps, tiers, layouts) belongs in per-tenant settings, not hardcoded.
- **No secrets in the repo.** All credentials are environment-driven. Only `.env.example` is committed; `.env` is gitignored.

## Getting started

1. Fork the repo and clone your fork.
2. Copy `.env.example` to `.env` and fill in values (see comments in that file).
3. Install dependencies and run the dev server (commands land here once `src/` is scaffolded).
4. Create a branch off `main`: `git checkout -b feature/short-description`.

## Making changes

- Keep pull requests focused — one logical change per PR.
- Match the style and structure of surrounding code; we favor readability over cleverness.
- Update relevant docs in `docs/` when behavior changes. If your change touches the tenant model, auth, payments, or privacy, note how it aligns with the Platform Mandate.
- Add or update tests where they exist for the area you touch.

## Submitting a pull request

1. Push your branch and open a PR against `main`.
2. Fill out the PR template — describe what changed, why, and how you verified it.
3. Confirm the mandate checklist (multi-tenant isolation, no PHI, phone-first) where applicable.
4. A maintainer will review. Be ready to iterate.

## Reporting bugs and requesting features

Use the issue templates. For anything security-related, **do not open a public issue** — follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's [AGPL-3.0](LICENSE) license.

## Code of conduct

All participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
