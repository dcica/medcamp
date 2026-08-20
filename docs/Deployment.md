# Deployment — Vercel + Supabase (test / prod)

This runbook stands up two live environments on the **free tier ($0/mo)**:

| Env | Vercel project | Branch | Host | Supabase schema | Stripe | Test-login |
|---|---|---|---|---|---|---|
| **test** | `medcamp-test` | `test` | `test.dcica.org` | `test` | test mode | **on** |
| **prod** | `medcamp-prod` | `main` | `events.dcica.org` | `prod` | test → live | **off** |

**`staging` is deliberately not provisioned.** `test.dcica.org` already plays
that role, and a third environment costs setup and free-tier surface for a gate
nobody was using. The `staging` branch, its CI job and `.env.staging.example`
remain in the repo as a no-op — the workflow job self-skips without secrets — so
standing it up later is only a matter of adding secrets.

**Topology:** separate Vercel **Hobby** projects importing the same repo, each
with its own Production Branch. **One** Supabase free project shared by every
environment, isolated by Postgres **schema** (`test`, `prod`, and optionally
`staging` / `dev`), set via `&schema=<name>` in the connection URL.

**Why one project:** Supabase's free tier allows only **2 active projects per
organization**. Packing every environment into one schema-separated project
leaves the second slot free and keeps the whole platform at $0/mo. Prisma targets
a non-default schema via `&schema=` and **qualifies every table name with the
schema in the generated SQL**, so it does not rely on a persisted `search_path`
and works under the shared transaction pooler. Each schema keeps its own
independent `_prisma_migrations` history.

**Isolation tradeoff — read this before trusting prod:** because prod now lives
in the same project as test, it shares that project's compute, connection budget,
`SUPABASE_SERVICE_ROLE_KEY` and Realtime publication. Isolation is by schema
only, not by credentials: the service-role key bypasses RLS and can reach every
schema, so the test key is effectively a prod key. There are no free-tier
backups. This is a **knowingly accepted interim posture** while the platform is
pre-revenue and the [Azure migration](superpowers/specs/2026-08-17-azure-migration-design.md)
is pending; it is not a pattern to carry forward. Concretely: **never run
`prisma migrate reset` against this project**, and scope every command with the
right `&schema=`.

> **Free-tier caveats — accepted, not solved**
> - Vercel **Hobby** is non-commercial in Vercel's ToS. Selling tickets is
>   commercial use, so the live-payments flip is the point at which Pro should
>   be bought, not a later convenience.
> - **Free Supabase projects auto-pause after ~7 days idle.** Every environment
>   shares one project, so any activity keeps it awake — but a quiet stretch
>   between events can still pause production. Pushing to a branch wakes it (CI
>   migrate connects to the DB); a cron pinging `/api/health` would prevent it.
> - **No backups and no PITR on the free tier.** Once real ticket orders exist,
>   this is the strongest argument for upgrading Supabase.

---

## How migrations work

Schema migrations are **owned by GitHub Actions**
([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)), **not** by
the Vercel build. The Vercel build stays `prisma generate && next build`.

On every push to `test` / `staging` / `main`, the matching CI job runs
`prisma migrate deploy` + seed against that environment's database, while Vercel
deploys the app in parallel. Each job **self-skips** if its `DIRECT_URL` secret
is absent, so an unprovisioned env (e.g. staging) is a clean no-op. Seeds are
idempotent upserts — safe to re-run on every push.

`prisma migrate deploy` uses **`DIRECT_URL`** (the direct 5432 connection);
the app at runtime uses **`DATABASE_URL`** (the pooled 6543 connection). Both
are already wired in `prisma/schema.prisma` — no schema change needed.

---

## Connection strings

From the Supabase dashboard → Project Settings → Database → Connection string.
**Every** environment appends `&schema=<env>` (`test` / `prod` / `staging` /
`dev`). No environment uses the default `public` schema — a URL missing the
param silently writes there instead, and `public` already holds a stray copy
from an earlier slip.

**`DATABASE_URL`** — app runtime on serverless. Use the **Supavisor transaction
pooler**, port **6543**, and append the flags:

```
# test (swap schema=prod / schema=staging / schema=dev)
postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&schema=test
```

- `pgbouncer=true` — disables Prisma prepared statements (the transaction pooler
  can't keep them).
- `connection_limit=1` — one connection per lambda so the pool isn't exhausted.
- `schema=<env>` — the env's Postgres schema on the shared non-prod project.

**`DIRECT_URL`** — migrations only. Direct/session connection, port **5432**
(same `schema=` param):

```
postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:5432/postgres?schema=test
```

Migrations need a real non-multiplexed session (DDL + advisory locks +
prepared statements); the transaction pooler would break them.

---

## Setup — ordered checklist

### 1. Supabase (one free project, one schema per env)

Create a single project in the same region as Vercel (`iad1` → US East) and
capture:

- pooled 6543 string → `DATABASE_URL` (add the flags; non-prod also `&schema=<env>`)
- direct 5432 string → `DIRECT_URL` (non-prod also `?schema=<env>`)
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- service_role key → `SUPABASE_SERVICE_ROLE_KEY`

Then pre-create one schema per environment (Supabase SQL editor):

```sql
CREATE SCHEMA IF NOT EXISTS test;
CREATE SCHEMA IF NOT EXISTS prod;
CREATE SCHEMA IF NOT EXISTS staging;  -- optional: not provisioned today
CREATE SCHEMA IF NOT EXISTS dev;      -- optional: Vercel Preview / cloud dev
```

The project-level vars (`NEXT_PUBLIC_SUPABASE_URL`, anon, service-role) are the
**same** for every environment — only `&schema=` in the DB URLs differs. Use an
**alphanumeric** DB password: a special character in the password surfaces as the
baffling `P1013 invalid port`. Use the **session pooler** host for `DIRECT_URL`;
`db.<ref>.supabase.co` is IPv6-only and unreachable from GitHub Actions and
Vercel.

### 2. Vercel (one Hobby project per env)

Import the repo once per environment. Set each project's **Production Branch**
in the **dashboard** — the CLI cannot set it:

| Project | Production Branch | Host |
|---|---|---|
| `medcamp-test` | `test` | `test.dcica.org` |
| `medcamp-prod` | `main` | `events.dcica.org` |

> Do **not** set any project's Production Branch to `demo/static-mvp` (stale).

Build command is auto-detected (`next build`); leave it as-is. Region `iad1`.

**The branch-pin trap:** an env var pinned to a git branch is **Preview-scoped**.
It never reaches the Production deployment, *and* it blocks setting that branch
as the Production Branch. Add every var to the **Production** scope unpinned.

### 2a. Custom domain (GoDaddy DNS)

`dcica.org` is registered at GoDaddy and GoDaddy holds the nameservers, so the
Vercel side and the DNS side are two separate steps:

1. Add the domain to the Vercel project (`vercel domains add <host> <project>`
   or the dashboard). Vercel returns a CNAME target.
2. In GoDaddy → Domain → DNS → Records, add `CNAME <sub> → <target>`, TTL
   **600** during cutover so a rollback propagates in minutes.
3. Wait for Vercel to verify and issue the TLS certificate.
4. Only then flip `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` and
   `NEXT_PUBLIC_ROOT_DOMAIN` to the custom host and redeploy. Certificate first,
   env second, redeploy third — that order avoids serving a broken host.

Attaching a domain does not migrate the integrations that are registered
*per host*. Google OAuth and the Stripe webhook must both be re-pointed (steps 4
and 5) or the new host will look fine and quietly fail to log anyone in or
confirm any payment.

### 3. Vercel env vars (per project, Production scope)

Fill each project from its template:
[`.env.test.example`](../.env.test.example),
[`.env.staging.example`](../.env.staging.example),
[`.env.production.example`](../.env.production.example). See the matrix below.

### 4. Google OAuth

Create an OAuth client per env (or one client with all redirect URIs) in Google
Cloud Console. Authorized redirect URI per env:

```
https://test.dcica.org/api/auth/callback/google
https://events.dcica.org/api/auth/callback/google
https://medcamp-test.vercel.app/api/auth/callback/google    (project alias)
https://medcamp-prod.vercel.app/api/auth/callback/google     (project alias)
http://localhost:3100/api/auth/callback/google               (local dev)
```

Put each `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the matching Vercel
project. **Register the custom-domain callback for every host you attach.** In
prod this is load-bearing: test-login is off, so Google is the only way in, and
an unregistered callback means `redirect_uri_mismatch` and an unadministrable
production environment.

### 5. Stripe

Test-mode keys for test; prod launches on test-mode keys too and switches to
**live** once the DCICA account is activated (see *Going live* below). Per env,
create a webhook endpoint — **this is not optional**. Confirmation is
webhook-authoritative; the `success_url` redirect happens to confirm the happy
path, so a missing endpoint looks fine in testing and silently leaves every
buyer who closes the tab stuck on a PENDING order with no email and no pass:

```
https://<env-domain>/api/stripe/webhook
```

Copy each endpoint's **signing secret** → `STRIPE_WEBHOOK_SECRET` in the
matching Vercel project. (A mismatched secret means payments never confirm —
confirmation is webhook-authoritative.)

### 6. GitHub (CI migrations)

Repo → Settings → Environments. Create `test` and `production` (`staging` is
optional and currently unprovisioned). Add secrets **`DATABASE_URL`** +
**`DIRECT_URL`** to each — the values differ only by `&schema=`. On
`production`, add a **required reviewer** so prod migrations need manual
approval.

### 7. Bootstrap each schema / DB

Either let the first push to the branch run CI, or run manually with that env's
strings exported (the `&schema=` in the URL targets the right schema):

```bash
npx prisma migrate deploy   # uses DIRECT_URL → creates tables in the env's schema
npm run db:seed             # dcica org + service menu (idempotent)
npm run db:seed:events      # real public event lineup
npm run db:seed:test        # test only — NEVER in prod
```

Run this once per env. The dcica org **must** exist in each schema or
`getActiveOrg()` finds no tenant and the app has no active org. Locally, target
a chosen env with `ENV_FILE=.env.<env> npm run db:migrate:deploy`.

### 8. Secrets hygiene

Generate a unique `NEXTAUTH_SECRET` per env:

```bash
openssl rand -base64 32
```

Never reuse secrets across envs; never commit `.env*` (gitignored). Live Stripe
keys live only in prod.

---

## Env-var matrix

| Var | test | prod |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` | `https://test.dcica.org` | `https://events.dcica.org` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `test.dcica.org` | `events.dcica.org` |
| `TENANT_ROUTING` | path | path |
| `DEFAULT_ORG_SLUG` | dcica | dcica |
| `BOOTSTRAP_ADMIN_EMAILS` | QA emails | **real coordinators** |
| `DATABASE_URL` | pooled, `&schema=test` | pooled, `&schema=prod` |
| `DIRECT_URL` | direct, `?schema=test` | direct, `?schema=prod` |
| `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` | shared project | shared project (optional — Realtime unused) |
| `NEXTAUTH_SECRET` | unique | unique |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | shared client, per-host callback | shared client, per-host callback |
| `STRIPE_*` (pk/sk) | test | test → **live** at activation |
| `STRIPE_WEBHOOK_SECRET` | test endpoint | prod endpoint (own secret) |
| `TEST_LOGIN_ENABLED` / `TEST_LOGIN_PASSWORD` | set | **unset** |
| `EMAIL_PROVIDER` / `EMAIL_FROM` | ses / `no-reply@dcica.org` | ses / `no-reply@dcica.org` |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | set (explicit) | set (explicit) |

---

## Branching & promotion

```
feature/* ─PR▶ test ─PR▶ main
test → medcamp-test → schema `test` → test.dcica.org
main → medcamp-prod → schema `prod` → events.dcica.org
```

Branch daily work off `test`. Promote forward via PR. Protect `main` (require PR
+ checks). `demo/static-mvp` is a legacy snapshot — merge any wanted commits into
`test` once, then stop using it.

---

## Going live with real payments

Production deliberately launches on Stripe **test-mode** keys, with every seeded
event left in `DRAFT`. `DRAFT` events are invisible on the public listing (which
filters to `OPEN`/`ACTIVE`), so a publicly-resolving prod host cannot take a
test-card "purchase" that would send a real confirmation email and QR pass.

When the DCICA Stripe account is activated, flip in this order:

1. Swap `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY` to `pk_live` /
   `sk_live`.
2. Create the webhook endpoint **again in live mode** — test and live endpoints
   are separate objects with separate signing secrets — and replace
   `STRIPE_WEBHOOK_SECRET`.
3. Redeploy.
4. Run one real small-amount purchase end to end; confirm the webhook fires, the
   order confirms, and the email with the QR pass arrives. Refund it.
5. Only now set the events that should be on sale to `OPEN`.
6. Buy Vercel Pro (see the ToS caveat above).

## Smoke tests (per live environment)

1. `GET /api/health` → `200` with `{ ok: true, db: "connected", counts: {...} }`.
2. Home / tenant page renders for dcica → proves seed + `DATABASE_URL`.
3. Google login round-trips back to `<env-domain>`, session cookie set,
   `/dashboard` reachable → proves `NEXTAUTH_URL` + redirect URI + DB sessions +
   middleware gate.
4. Test-login: `/test-login` works on **test**; on prod it must **404**
   (the page 404s entirely unless `TEST_LOGIN_ENABLED=true`).
5. Registration → Stripe hosted Checkout (test card `4242 4242 4242 4242` on
   test) → `checkout.session.completed` → `/api/stripe/webhook` verifies the
   signature → order/registration confirmed.
6. `npx prisma migrate status` (with that env's `DIRECT_URL`) → up to date.

---

## Risks / guardrails

- **`TEST_LOGIN_ENABLED` must be unset/false in prod** — the #1 prod-safety
  toggle. Verify with smoke test 4.
- **Prisma + pgbouncer** — `DATABASE_URL` must be the 6543 pooler with
  `pgbouncer=true&connection_limit=1`; migrations must use `DIRECT_URL` (5432),
  or they fail under the pooler.
- **Wrong `&schema=`** — now the only thing separating **production** from test,
  which raises the stakes considerably. A URL missing the param lands in
  `public`, and a CI job with the wrong schema migrates/seeds the wrong
  environment. Double-check the param in both `DATABASE_URL` and `DIRECT_URL`,
  in Vercel *and* in the GitHub Environment, every time. Never
  `prisma migrate reset` this project — it would wipe the targeted schema.
- **Google OAuth is the only door into prod.** Test-login is off, so an
  unregistered `https://events.dcica.org/api/auth/callback/google` means nobody
  can administer production. Register it before you need it.
- **`NODE_ENV` is always `production` on Vercel**, so `/api/dev/confirm` and the
  "Simulate payment (dev)" button are dead on every deployed environment,
  including test. Payment testing must go through real Stripe Checkout.
- **Stripe webhook secret mismatch** → payments silently never confirm. Each env
  has its own endpoint + secret.
- **`env.ts` degrades silently** (`safeParse` → `{}`) — a misconfigured prod boots
  degraded rather than failing loudly. The smoke tests are the safety net.
- **Free Supabase auto-pause** — restore before demos (see caveats above).
