# Deployment — Vercel + Supabase (test / staging / prod)

This runbook stands up three environments on the **free tier ($0/mo)**:

| Env | Vercel project | Branch | Supabase DB | Stripe | Test-login |
|---|---|---|---|---|---|
| **test** | `medcamp-test` | `test` | TEST (free) | test mode | **on** |
| **staging** | `medcamp-staging` | `staging` | _deferred_ | test mode | on |
| **prod** | `medcamp-prod` | `main` | PROD (free) | **live** | **off** |

**Topology:** three separate Vercel **Hobby** projects, all importing the same
repo, each with its own Production Branch. Isolation comes from **separate
Supabase projects + separate Stripe/Google credentials per env**, not from the
Vercel projects themselves.

**Why staging's DB is deferred:** Supabase's free tier allows only **2 active
projects per organization**. `test` and `prod` take the two free slots. The
`medcamp-staging` Vercel project, the [`.env.staging.example`](../.env.staging.example)
template, and the `staging` CI job all exist and are ready — staging goes fully
live the moment a 3rd database is added (paid upgrade or a freed slot). Until
then the staging site deploys but has no DB, and its migrate job self-skips.

> **Free-tier caveats**
> - Vercel **Hobby** is technically non-commercial in Vercel's ToS — a gray area
>   for a non-profit reference deploy. Upgrade to Pro before real production use.
> - **Free Supabase projects auto-pause after ~7 days idle.** Restore the project
>   in the dashboard before any demo; pushing to the branch also wakes it (the CI
>   migrate connects to the DB).

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

## Connection strings (per Supabase project)

From the Supabase dashboard → Project Settings → Database → Connection string.

**`DATABASE_URL`** — app runtime on serverless. Use the **Supavisor transaction
pooler**, port **6543**, and append the two flags:

```
postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

- `pgbouncer=true` — disables Prisma prepared statements (the transaction pooler
  can't keep them).
- `connection_limit=1` — one connection per lambda so the pool isn't exhausted.

**`DIRECT_URL`** — migrations only. Direct/session connection, port **5432**:

```
postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:5432/postgres
```

Migrations need a real non-multiplexed session (DDL + advisory locks +
prepared statements); the transaction pooler would break them.

---

## Setup — ordered checklist

### 1. Supabase (2 free projects now)

Create `medcamp-test` and `medcamp-prod` in the same region as Vercel
(`iad1` → US East). Defer `medcamp-staging`. For each project capture:

- pooled 6543 string → `DATABASE_URL` (add the two flags)
- direct 5432 string → `DIRECT_URL`
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- service_role key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Vercel (3 Hobby projects)

Import the repo three times. Set each project's **Production Branch**:

| Project | Production Branch |
|---|---|
| `medcamp-test` | `test` |
| `medcamp-staging` | `staging` |
| `medcamp-prod` | `main` |

> Do **not** set any project's Production Branch to `demo/static-mvp` (stale).

The auto-assigned URLs (`medcamp-test.vercel.app`, etc.) are the env domains for
now. Build command is auto-detected (`next build`); leave it as-is.

### 3. Vercel env vars (per project, Production scope)

Fill each project from its template:
[`.env.test.example`](../.env.test.example),
[`.env.staging.example`](../.env.staging.example),
[`.env.production.example`](../.env.production.example). See the matrix below.

### 4. Google OAuth

Create an OAuth client per env (or one client with all redirect URIs) in Google
Cloud Console. Authorized redirect URI per env:

```
https://medcamp-test.vercel.app/api/auth/callback/google
https://medcamp-staging.vercel.app/api/auth/callback/google
https://medcamp-prod.vercel.app/api/auth/callback/google
http://localhost:3100/api/auth/callback/google      (local dev)
```

Put each `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the matching Vercel
project.

### 5. Stripe

Test-mode keys for test + staging; **live**-mode for prod. Per env, create a
webhook endpoint:

```
https://<env-domain>/api/stripe/webhook
```

Copy each endpoint's **signing secret** → `STRIPE_WEBHOOK_SECRET` in the
matching Vercel project. (A mismatched secret means payments never confirm —
confirmation is webhook-authoritative.)

### 6. GitHub (CI migrations)

Repo → Settings → Environments. Create `test`, `staging`, `production`. Add
secrets **`DATABASE_URL`** + **`DIRECT_URL`** to `test` and `production` now
(add `staging` when its DB exists). On `production`, add a **required reviewer**
so prod migrations need manual approval.

### 7. Bootstrap each live DB

Either let the first push to the branch run CI, or run manually with that env's
strings exported:

```bash
npx prisma migrate deploy   # uses DIRECT_URL
npm run db:seed             # dcica org + service menu + sample camp (idempotent)
npm run db:seed:test        # test only — NEVER in prod
```

The dcica org **must** exist or `getActiveOrg()` finds no tenant and the app has
no active org.

### 8. Secrets hygiene

Generate a unique `NEXTAUTH_SECRET` per env:

```bash
openssl rand -base64 32
```

Never reuse secrets across envs; never commit `.env*` (gitignored). Live Stripe
keys live only in prod.

---

## Env-var matrix

| Var | test | staging _(deferred)_ | prod |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` | test URL | staging URL | prod URL |
| `NEXT_PUBLIC_ROOT_DOMAIN` | test host | staging host | prod host |
| `TENANT_ROUTING` | path | path | path |
| `DEFAULT_ORG_SLUG` | dcica | dcica | dcica |
| `BOOTSTRAP_ADMIN_EMAILS` | QA emails | team emails | real admins |
| `DATABASE_URL` | TEST pooled 6543 | (later) | PROD pooled 6543 |
| `DIRECT_URL` | TEST direct 5432 | (later) | PROD direct 5432 |
| `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` | TEST | (later) | PROD |
| `NEXTAUTH_SECRET` | unique | unique | unique |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | test client | staging client | prod client |
| `STRIPE_*` (pk/sk) | test | test | **live** |
| `STRIPE_WEBHOOK_SECRET` | test endpoint | staging endpoint | prod endpoint |
| `TEST_LOGIN_ENABLED` | true | true | **unset/false** |
| `TEST_LOGIN_PASSWORD` | set | set | **unset** |
| `EMAIL_PROVIDER` / `EMAIL_FROM` / `RESEND_API_KEY` | sandbox | staging | prod |

---

## Branching & promotion

```
feature/* ─PR▶ test ─PR▶ staging ─PR▶ main
test    → medcamp-test    → Supabase TEST
staging → medcamp-staging → (DB deferred)
main    → medcamp-prod    → Supabase PROD
```

Branch daily work off `test`. Promote forward via PR. Protect `staging` and
`main` (require PR + checks). `demo/static-mvp` is a legacy snapshot — merge any
wanted commits into `test` once, then stop using it.

---

## Smoke tests (per live environment)

1. `GET /api/health` → `200` with `{ ok: true, db: "connected", counts: {...} }`.
2. Home / tenant page renders for dcica → proves seed + `DATABASE_URL`.
3. Google login round-trips back to `<env-domain>`, session cookie set,
   `/dashboard` reachable → proves `NEXTAUTH_URL` + redirect URI + DB sessions +
   middleware gate.
4. Test-login (`/test-login`) works on **test**; **rejected on prod**.
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
- **Stripe webhook secret mismatch** → payments silently never confirm. Each env
  has its own endpoint + secret.
- **`env.ts` degrades silently** (`safeParse` → `{}`) — a misconfigured prod boots
  degraded rather than failing loudly. The smoke tests are the safety net.
- **Free Supabase auto-pause** — restore before demos (see caveats above).
