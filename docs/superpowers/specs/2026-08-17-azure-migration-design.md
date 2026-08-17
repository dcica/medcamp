# Azure Migration Design — medcamp

**Date:** 2026-08-17
**Status:** Approved (design). Implementation plan pending.
**Decision owner:** Sachin Jain
**Supersedes:** nothing. Complements `docs/Deployment.md`, which documents the
current Vercel + Supabase topology and stays authoritative until cutover completes.

## 1. Why

Denton County India Cultural Association (DCICA) was approved for Microsoft
Elevate nonprofit offers on 2026-08-17, including a **$2,000 USD Azure credit
grant** running **2026-08-17 → 2027-08-17**, claimed under the tenant account
`sachin@dentoncica.onmicrosoft.com`.

The decision is a **full replacement**: Azure becomes the only home for the
application and database across all environments. Vercel and Supabase are
decommissioned once production is green.

### Is the grant durable enough to build on?

Yes, with one recurring obligation. The grant is **annually renewable and not
time-limited to a single year**, but:

- Renewal is **manual**, via Nonprofit Hub → *Nonprofit grants* → *Renew Now*.
- The renewal window opens **only 30 days before expiry** — for DCICA,
  **2027-07-18 → 2027-08-17**.
- Microsoft states it will send a **reminder email a few weeks before
  expiration**. Treat this as a helpful backstop, not the primary control: it
  lands in one inbox, and grant emails to date have gone to
  `sachin@dentoncica.onmicrosoft.com` — an account the wider board does not
  monitor.
- Credits **do not roll over**. Unused balance is forfeited at period end.
- Microsoft **does not increase or extend** the $2,000 amount, and will not
  extend mid-term.
- **If renewal is missed, the subscription auto-converts to pay-as-you-go** and
  charges the payment instrument on the billing profile. Usage during the gap is
  billed at standard rates and is not retroactively credited. Some organizations
  instead report the subscription being **disabled outright** — application down,
  compute stopped.

This is therefore effectively a perpetual $2,000/yr, contingent on one calendar
action each July and continued 501(c)(3) verification. See §9 for the runbook.

**Status as of 2026-08-17:** credits are issued and awaiting activation.
Activation creates a **new subscription**; applying the grant to an existing
subscription instead requires contacting Azure support. Self-service activation
is the intended path — the Nonprofit Azure Onboarding Concierge and partner-led
options are available but not needed at this scale.

### Cost posture

Design to **~$60/mo, not ~$166/mo.** Rationale:

1. Leftover credit is not waste — it is headroom for camp-day scale-out and
   insurance against a missed renewal at PAYG rates.
2. $166/mo buys capacity this workload will never use. A camp is 300–500
   patients over a half day, a few times a year.
3. A $60/mo footprint survives a renewal failure as an annoyance. A $166/mo
   footprint becomes a board conversation.

## 2. Portability findings (why this migration is cheap)

Established by reading the repository, not assumed:

- **Supabase is Realtime-only and Realtime is not wired.** `src/lib/supabase.ts`
  exists solely to build a Realtime client; `src/app/dashboard/AutoRefresh.tsx`
  and `src/app/station/[key]/QueueView.tsx` both poll and carry comments saying
  Realtime is a future upgrade. The three `NEXT_PUBLIC_SUPABASE_*` /
  `SUPABASE_SERVICE_ROLE_KEY` vars are `.optional()` in `src/lib/env.ts`.
  Supabase is currently Postgres-with-extras, and only the Postgres is used.
- **No Row-Level Security exists.** Zero policies across all nine migrations.
  The multi-tenant RLS mandate is unimplemented, so nothing is forfeited by
  leaving Supabase — RLS is native Postgres and behaves identically on Azure.
- **No Vercel edge-runtime coupling.** No `export const runtime = 'edge'`
  anywhere under `src/app`. The application is pure Node.js.

## 3. Topology

Single subscription (the Azure sponsorship). **Region: South Central US**
(San Antonio — lowest latency to Denton County). **Fallback: Central US** if a
required SKU is capacity-constrained at provisioning time.

Three resource groups, so an entire environment can be torn down in one action:

```
rg-medcamp-prod     → app-medcamp-prod,  asp-medcamp-prod (B2)
rg-medcamp-nonprod  → app-medcamp-test, app-medcamp-dev, asp-medcamp-nonprod (B1)
rg-medcamp-shared   → psql-medcamp (B1ms), kv-medcamp, appi-medcamp
```

The database lives in `rg-medcamp-shared` deliberately: it outlives any single
app deployment, and placing it in `rg-medcamp-prod` would make a production
teardown destructive to all three environments.

## 4. Compute — Azure App Service (Linux)

| Env | Plan | Tier | Apps on plan |
|---|---|---|---|
| prod | `asp-medcamp-prod` | **B2** (2 vCore, 3.5 GB) | `app-medcamp-prod` |
| test + dev | `asp-medcamp-nonprod` | **B1** (1 vCore, 1.75 GB) | `app-medcamp-test`, `app-medcamp-dev` |

Runtime: **Node 22**, Linux. `next.config.mjs` gains `output: 'standalone'`.
**Always On** enabled on prod.

**Why B2 for prod, not B1.** `next/image` optimization was previously performed
by Vercel at no cost to the application. On App Service it consumes the
instance's own CPU, and event banner images are self-hosted under
`/public/events`. B2 buys headroom for that. §11 tracks measuring whether B1
would in fact suffice.

**Why App Service rather than Container Apps.** Container Apps' scale-to-zero is
attractive for bursty camp-day traffic, but cold starts are precisely wrong for
a volunteer holding a phone at a check-in desk. Pinning `min-replicas=1` in
production erases most of the saving while adding a container build and registry
to the pipeline. Revisit only if traffic patterns change materially.

**No deployment slots on Basic tier.** Slots require Standard or higher. A
deploy therefore restarts the app for roughly 30–60 seconds. The accepted
mitigation is an **operational deploy freeze on camp days**, not a $70/mo tier
upgrade. Revisit only if this causes a real incident.

**Camp-day burst lever.** Basic supports manual scale-out to 3 instances. Scale
prod to 2–3 instances the morning of a camp and back down afterward. This costs
a few dollars per camp day and requires no re-architecture.

## 5. Database — Azure Database for PostgreSQL Flexible Server

**One server**, `psql-medcamp`, tier **B1ms** (Burstable, 1 vCore, 2 GB),
32 GB storage, hosting **three databases**:

```
medcamp_dev     medcamp_test     medcamp_prod
```

### Why three databases rather than three schemas

The current Supabase layout separates non-prod environments by *schema*, which
requires `&schema=<env>` on every connection string. A URL missing that
qualifier silently writes to `public` — a documented footgun in
`docs/Deployment.md` that has already caused a stray full copy of the data to be
built in `public`.

Database separation removes the failure mode entirely: the three connection
strings differ only in the `/dbname` path segment, and omitting it fails loudly
rather than succeeding in the wrong place.

### Connection handling

`DIRECT_URL` collapses into `DATABASE_URL` — there is no pooler in front.

**PgBouncer is deliberately absent.** Built-in PgBouncer is **not supported on
the Burstable tier**; it requires General Purpose or Memory Optimized
(~$125+/mo). It is also not needed: App Service runs **one persistent Node
process**, not per-request serverless instances. Connection exhaustion is an
artifact of Vercel's serverless model — the reason Supabase's pooler was
required at all — and does not follow the app to App Service. A single
long-lived Prisma pool against Postgres is the ordinary case.

Set Prisma `connection_limit` explicitly per environment:

| Env | `connection_limit` |
|---|---|
| prod | 10 |
| test | 5 |
| dev | 5 |

### Accepted constraints of the Burstable tier

Stated explicitly so no one later assumes otherwise:

- **`max_connections` is server-wide** (approximately 50 on B1ms) and shared
  across all three databases. The limits above leave ample margin, but this is a
  real ceiling. Confirm the actual value on the provisioned server (§11).
- **No high availability** and **no read replicas** on Burstable. Correct for
  this workload; not a defect.
- **Maintenance causes roughly 60 seconds of downtime across all three databases
  simultaneously.** Pin the maintenance window away from known camp dates.
- Point-in-time restore is included. Backup storage up to the provisioned 32 GB
  is free.

## 6. Configuration, secrets, networking

- **Azure Key Vault** (`kv-medcamp`, in `rg-medcamp-shared`), referenced from
  App Service application settings via `@Microsoft.KeyVault(...)`. Holds
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the three `DATABASE_URL` values,
  SES credentials, and `NEXTAUTH_SECRET`.

  This also resolves a known operational problem: `vercel env pull` returns
  **empty values** for variables marked Sensitive, so they cannot be read back
  and must be re-entered from memory. Key Vault secrets are readable by
  authorized humans.

- **PostgreSQL network access:** public access with a firewall restricted to the
  App Service outbound IP addresses (stable on Basic tier) plus named
  administrator IPs, with `require_secure_transport=ON`. Private Endpoint /
  VNet integration is deferred hardening — see §11, as Basic-tier VNet support
  must be verified before it is promised.

- **Application Insights** (`appi-medcamp`), free tier (5 GB/month ingestion),
  connected to all three apps.

- **Custom domain** on production (e.g. `medcamp.dentoncica.org`) with a **free
  App Service Managed Certificate**. Basic B1+ satisfies the minimum tier for
  both custom domains and managed certificates (SNI SSL).

### Subscription governance (perform at activation)

Microsoft recommends these immediately after activating the subscription. They
are adopted here as requirements, not suggestions — this subscription will hold
Stripe live keys and the production database for a system that runs live medical
camps.

| Control | Why it matters here |
|---|---|
| **Enforce multi-factor authentication** | The subscription owns production payment credentials. A single compromised account is a total compromise. |
| **Cost alerts via Azure Cost Management / Azure Monitor** | Already required by §9. Configure once, serve both purposes. |
| **Service Health alerts** | Advance warning of Azure-side incidents and maintenance — directly relevant to the "never go dark on a camp day" posture. |
| **Entra ID Identity Protection risk alerts** | Detects high-risk sign-ins against the tenant that now controls production. |
| **Subscription directory-movement policy** | Prevents the subscription being moved out of the DCICA tenant, accidentally or otherwise. |

Assign **at least two people** with owner-level access. A grant subscription
bound to one individual is an organizational single point of failure — the same
failure mode as the renewal reminder in §9.

## 7. CI/CD

GitHub Actions remains the deployment mechanism. `.github/workflows/deploy.yml`
is extended, not replaced.

> **Prerequisite — blocks this section.** Azure automation access (an Entra
> application registration plus federated credentials for the GitHub repository,
> and a role assignment scoped to the three resource groups) must exist before
> any CI/CD work can begin. Sachin will provision this after activating the
> subscription. Nothing in §7 is actionable until it lands; §3–§6 provisioning
> can proceed by hand in the portal in the meantime.

- Authenticate to Azure using **OIDC workload identity federation**, so no
  long-lived cloud credentials are stored in GitHub.
- Per-environment secrets continue to come from GitHub Environments; the values
  change from Supabase URLs to Azure Postgres URLs.
- Job order is preserved, with deployment appended:

```
prisma migrate deploy → db:seed → db:seed:events → db:seed:test → azure/webapps-deploy
```

Migrations run **before** application deployment, exactly as today. The App
Service build does not migrate, mirroring the existing rule that the Vercel
build never migrated.

## 8. Service disposition

| Service | Disposition | Rationale |
|---|---|---|
| **Supabase** | **Removed entirely** | Realtime-only in code, and Realtime is not wired. Remove `@supabase/supabase-js`, `src/lib/supabase.ts`, and the three optional env vars from `src/lib/env.ts`. |
| **Vercel** | **Decommissioned after cutover** | Keep the three projects dormant through one full camp cycle as a rollback path, then delete. |
| **AWS SES** | **Retained** | Working, already debugged (explicit-credentials and Windows CRLF issues resolved), costs roughly $0.10/mo at this volume. "Full replacement" scopes hosting, not every vendor. |
| **NextAuth / Google OAuth** | **Retained** | Requires new redirect URIs only. |
| **Realtime (future)** | **Azure Web PubSub, free tier** | 20 concurrent connections covers roughly 15 station tablets plus coordinator. Deferred to Module 4; polling remains the shipped behavior until then. |
| **Microsoft Entra ID** | **Optional addition** | DCICA owns the `dentoncica.onmicrosoft.com` tenant, making Microsoft a zero-cost second OIDC provider. Not required for cutover. |

## 9. Grant renewal runbook

Chosen posture: **fail-open with alerting** — a live camp must never go dark.

1. **Attach a payment method** to the billing profile, so a lapse converts to
   pay-as-you-go and the application keeps serving rather than being disabled.
2. **Azure Budget** on the subscription at $2,000/yr, with alerts at **50%, 75%,
   and 90%**, delivered to **more than one person**.
3. **Calendar reminder on 2027-07-18** — the day the 30-day renewal window opens
   — with a **second reminder holder**. This is the single
   highest-consequence recurring task in this design. Microsoft's own reminder
   email is a backstop, not the control: it arrives at
   `sachin@dentoncica.onmicrosoft.com`, which no one else monitors.
4. At approximately $61/mo, expected consumption by renewal is roughly 44% of
   the grant. **If a budget alert fires materially above that trajectory,
   investigate before renewing** — it indicates something is misconfigured.

## 10. Cost

| Item | Approx. $/mo |
|---|---|
| App Service B2 (prod) | 26 |
| App Service B1 (dev + test, shared plan) | 13 |
| PostgreSQL Flexible B1ms + 32 GB storage | 20 |
| Key Vault, Application Insights, DNS | ~2 |
| **Total** | **~61** |

Approximately **$730/yr against a $2,000 grant** — about 36% consumed, leaving
roughly $1,270 as headroom and lapse insurance.

These are list prices for a US region. **Confirm in the Azure pricing calculator
before provisioning.**

## 11. Open items

These are tracked deliberately and must be resolved during implementation, not
assumed:

| # | Item | Action |
|---|---|---|
| 1 | Basic-tier VNet integration support | Verify against current Azure documentation before promising private networking for PostgreSQL. Public access + firewall is the committed baseline regardless. |
| 2 | Actual `max_connections` on B1ms | Read from the provisioned server. Do not rely on the ~50 estimate in §5. |
| 3 | Whether prod requires B2 or B1 suffices | Measure `next/image` optimization CPU after the first production deploy; downgrade if B1 holds. |
| 4 | Exact pricing | Validate every line in §10 in the Azure pricing calculator for South Central US. |

## 12. Out of scope

- Multi-tenant Row-Level Security implementation (tracked separately under the
  Platform Mandate; this design neither adds nor blocks it).
- Migrating AWS SES to Azure Communication Services.
- Wiring Realtime (Module 4).
- Any change to application features, schema, or business logic. This design
  changes where the application runs, and nothing else.

## Sources

- [Renew Your Azure Grant — Microsoft for Nonprofits](https://learn.microsoft.com/en-us/industry/nonprofit/microsoft-for-nonprofits/renew-azure-grant)
- [Activate Your Azure Grant — Microsoft for Nonprofits](https://learn.microsoft.com/en-us/industry/nonprofit/microsoft-for-nonprofits/claim-activate-nonprofit-azure-grant)
- [Nonprofit sponsorship not renewed — subscription disabled](https://learn.microsoft.com/en-us/answers/questions/5677242/azure-nonprofit-community-sponsorship-subscription)
- [PgBouncer in Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer)
- [Azure App Service plans — tier comparison](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)
- [Secure an App Service app with a custom domain and certificate](https://learn.microsoft.com/en-us/azure/app-service/tutorial-secure-domain-certificate)
