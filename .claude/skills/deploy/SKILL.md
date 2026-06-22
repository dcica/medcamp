---
name: deploy
description: >-
  Deploy the medcamp platform to Vercel + Supabase and run DB migrations/seeds
  for an environment. Use when pushing a release, applying migrations, seeding
  test/staging/prod, or debugging deploy / DB-connection issues. Encodes the
  schema-separation, session-pooler, and Sensitive-var gotchas specific to this repo.
---

# medcamp — Deploy & DB runbook

Authoritative long-form doc: `docs/Deployment.md`. This skill is the operational
quick-path + the gotchas that bite. Read the mental model before running anything.

## Mental model (read first)

- **Deploys are push-driven.** Each env is its own Vercel project pinned to a branch:
  `test` → `medcamp-sigma`, plus `staging` and `main` (prod). `git push origin <branch>`
  builds & deploys the app for that env. Production Branch is set in the **Vercel
  dashboard**, not the CLI.
- **CI owns DB migrate + seed — the Vercel build does NOT.** Build stays
  `prisma generate && next build` (migrations were deliberately removed from it;
  Sensitive env vars aren't available at git-integration build time). Instead
  `.github/workflows/deploy.yml` runs, on push to `test`/`staging`/`main`:
  `prisma migrate deploy` → `db:seed` → `db:seed:events` → `db:seed:test`
  (prod runs `db:seed` only — **never** `db:seed:test` in prod). It uses each GitHub
  Environment's `DATABASE_URL`/`DIRECT_URL` secrets.
- **Net effect:** push to `test` ⇒ app deploys *and* CI migrates+seeds the `test`
  schema. You usually do **not** need to run migrations by hand.

## Normal path (99% of the time)

```bash
git push origin test          # → Vercel deploys app + CI migrates+seeds test schema
# watch the "DB migrate + seed" workflow in GitHub Actions
```
Verify: `GET https://medcamp-sigma.vercel.app/api/health` → ok, DB connected, event count.

## Schema separation — the #1 footgun

Non-prod `test` / `staging` / `dev` share **ONE** Supabase project, isolated **only**
by Postgres schema via `&schema=<env>` in the connection URL. Prod is a separate
project on `public`.

- A non-prod URL **missing `&schema=test` silently targets `public`** — migrations and
  seeds land in the wrong place and the app (which reads `test`) sees nothing. If you
  ever see `type "PaymentMethod" does not exist` in the SQL console, you're querying the
  empty `public` schema — switch to the `test` schema.
- Pooled URL: `...:6543/postgres?pgbouncer=true&connection_limit=1&schema=test`
- Direct URL: `...:5432/postgres?schema=test`
- Each schema keeps its own `_prisma_migrations` history.

## Manual / local DB runs (special cases only)

Seeds and the migrate wrapper honor `ENV_FILE` (default `.env`). `.env.test` is
gitignored — fill it from Supabase → Settings → Database → Connection string, and
**include `&schema=test`** (see the file's header).

```bash
# PowerShell (this repo's primary shell):
$env:ENV_FILE=".env.test"; npm run db:migrate:deploy   # wrapper: prisma/migrate-deploy.ts
$env:ENV_FILE=".env.test"; npm run db:seed:test
# bash:
ENV_FILE=.env.test npm run db:migrate:deploy
ENV_FILE=.env.test npm run db:seed:test
```
- `db:migrate:deploy` = `tsx prisma/migrate-deploy.ts` (loads ENV_FILE, then
  `npx prisma migrate deploy`). Migrations connect via **`DIRECT_URL`**.
- Seeds: `db:seed` (org + service menu + sample camp), `db:seed:events` (real dcica
  public lineup — replaces all events), `db:seed:test` (ACTIVE test camp + dandia gate
  + test users + full new-feature fixtures: membership, donations, qty lines, will-call
  `fulfilledAt`, ledger CREDIT/DEBIT, COMP, refund). Run order matters: events FIRST,
  test fixtures layer on top. All idempotent.

## Connection-string gotchas (each cost real time)

- **Direct host is IPv6-only.** `db.<ref>.supabase.co:5432` is unreachable from most
  networks / CI. Use the **Session pooler** for `DIRECT_URL`: pooler host, port 5432,
  user `postgres.<ref>` (e.g. `aws-1-us-east-2.pooler.supabase.com:5432`).
- **`P1013 invalid port`** = a special char (or stray `/`, or literal `[YOUR-PASSWORD]`)
  in the password. Use an alphanumeric DB password.
- **Sensitive Vercel vars** aren't exposed to git-integration builds (why migrate is in
  CI, not build) and `vercel env pull` returns **empty** values for them — re-enter, can't copy.
- **Branch-pinned Vercel vars are Preview-only** — they don't reach Production and block
  setting that branch as Production Branch. Put vars in **Production** scope, unpinned.
- **`ALTER TYPE ... ADD VALUE`** can't be used in the same transaction that references the
  new value; on old PG it can't run in a transaction at all. Supabase (PG15) is fine.

## Don't

- Don't add `prisma migrate deploy` to the Vercel build command (it breaks git-triggered
  deploys — Sensitive vars absent). CI owns it.
- Don't run non-prod migrate/seed without `&schema=test` (pollutes `public`).
- Don't run `db:seed:test` against prod.
- Don't commit `.env.test` (gitignored) or paste real connection strings into tracked files.

## Verify after deploy

- `GET /api/health` — ok + DB connected + event count.
- `/events` (public), `/gate` (dandia), `/test-login` (needs `TEST_LOGIN_ENABLED=true`
  in the env's Vercel vars for the deployed site).
