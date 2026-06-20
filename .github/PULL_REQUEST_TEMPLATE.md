## What & why

What does this PR change, and what problem does it solve? Link any related issue (`Closes #123`).

## How it was verified

How did you test this? (manual steps, tests added, screenshots for UI).

## Mandate checklist

Confirm alignment with the [Platform Mandate](docs/Platform-Mandate.md) — check all that apply, or note N/A:

- [ ] **Multi-tenant isolation** — no cross-tenant reads/writes; queries respect `org_id` / RLS
- [ ] **No PHI/HIT** — no clinical fields added; patient data stays camp-scoped
- [ ] **Phone-first** — volunteer-facing UI works on a 6" phone (48px targets, single column)
- [ ] **Config over code** — tenant-specific behavior is a setting, not hardcoded
- [ ] **No secrets** — no credentials committed; `.env.example` updated if new env vars added
- [ ] **Docs updated** — relevant `docs/` files reflect the change

## Notes for reviewers

Anything reviewers should focus on, trade-offs made, or follow-ups deferred.
