/**
 * GA4 property setup — the parts of the account checklist that have an API.
 *
 *   npx tsx scripts/setup-ga4.ts                 # dry run, prints the plan
 *   npx tsx scripts/setup-ga4.ts --apply         # actually writes
 *
 * Inputs (env or flag):
 *   GA4_PROPERTY_ID   numeric property id, e.g. 493820117. NOT the G-XXXX
 *                     measurement id — a different identifier entirely, found
 *                     under GA4 Admin → Property settings.
 *   GA_ACCESS_TOKEN   optional. Falls back to
 *                     `gcloud auth application-default print-access-token`,
 *                     which must have been granted the analytics.edit scope:
 *                       gcloud auth application-default login --scopes="openid,\
 *                         https://www.googleapis.com/auth/userinfo.email,\
 *                         https://www.googleapis.com/auth/cloud-platform,\
 *                         https://www.googleapis.com/auth/analytics.edit"
 *                     The consenting account needs Editor or Administrator ON
 *                     THE GA4 PROPERTY. GCP project roles do not grant that —
 *                     GA permissions live in GA, and this is the single most
 *                     common reason a 403 comes back from a correctly-scoped
 *                     token.
 *
 * WHY THIS EXISTS RATHER THAN A DOC SAYING "click these six things".
 * `docs/Analytics.md` still carries the console walkthrough, because four of the
 * nine steps have no API at all (see BELOW THE API LINE). This script covers the
 * list-entry half, and it exists for the second tenant, not the first: dcica's
 * six objects are three minutes of clicking, but the platform mandate says
 * self-serve org onboarding is coming, and every tenant that connects its own GA
 * property needs exactly these same six objects with exactly these names or its
 * reports come back empty. Typing them by hand once per tenant is a
 * silent-failure machine — a dimension registered as `event_type` instead of
 * `event_kind` produces no error anywhere, just permanently blank report columns.
 *
 * BELOW THE API LINE — must be done in the console, by hand, per property:
 *   - Unwanted referrals (`checkout.stripe.com`). Stream tag settings. This is
 *     the highest-value item on the whole checklist and there is no API for it.
 *   - Internal traffic DEFINITION (the IP match rules). Stream tag settings.
 *     The data FILTER that consumes it does have an API, but creating the filter
 *     before the definition exists just makes an object that matches nothing —
 *     which is why this script deliberately does not create it.
 *   - Search Console link.
 *   - Reporting identity (set to device-based).
 *
 * Idempotent by construction: every step lists what already exists and skips it,
 * so a re-run after a partial failure is safe and prints SKIP rather than
 * creating duplicates. GA4 rejects a duplicate parameterName anyway, but relying
 * on a remote 409 to be your idempotency guard means the script dies halfway
 * through instead of finishing the rest.
 */

import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

// ── What we register ────────────────────────────────────────────────────────
//
// These names are a CONTRACT with the application code, not a preference. An
// unregistered or misspelled parameter is collected by GA4 and then invisible in
// every report, with no warning anywhere. Cross-check before editing:
//   event_slug, event_kind, payment_method → src/lib/ga.ts (purchase payload)
//   event_slug, event_kind                 → src/lib/analyticsEvents.ts (funnel)

const CUSTOM_DIMENSIONS = [
  {
    parameterName: "event_slug",
    displayName: "Event slug",
    description:
      "Public slug of the event a hit relates to. Same string as the /e/<slug> page, which is what makes a landing page joinable to the sale it produced.",
  },
  {
    parameterName: "event_kind",
    displayName: "Event kind",
    description:
      "CAMP | GENERAL | MEMBERSHIP_DRIVE. Lets camp conversion be compared against ticketed events. Says nothing about any individual.",
  },
  {
    parameterName: "payment_method",
    displayName: "Payment method",
    description:
      "STRIPE | CASH | ZELLE | CHECK. Only ever STRIPE in practice today, because orders without a web session send no purchase event.",
  },
] as const;

// countingMethod ONCE_PER_EVENT is right for all three: a second purchase in one
// session is a second sale, not a repeat of the first.
const KEY_EVENTS = ["purchase", "sign_up", "generate_lead"] as const;

// Deliberately NOT a key event. begin_checkout is a funnel STEP — marking it a
// key event puts it in the same column as completed sales and makes the
// conversion figure meaningless.
const NOT_A_KEY_EVENT = "begin_checkout";

const ADMIN_V1 = "https://analyticsadmin.googleapis.com/v1beta";
const ADMIN_V1A = "https://analyticsadmin.googleapis.com/v1alpha";

// ── Plumbing ────────────────────────────────────────────────────────────────

const apply = process.argv.includes("--apply");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const propertyId = arg("property") ?? process.env.GA4_PROPERTY_ID;

/**
 * Get an access token good for the Analytics Admin API.
 *
 * A SERVICE ACCOUNT is the supported path, and the reason is not preference.
 * `analytics.edit` is a Google-classified SENSITIVE scope, and the OAuth client
 * baked into `gcloud auth application-default login` is not verified for it — the
 * consent screen returns "This app is blocked / This app tried to access
 * sensitive info in your Google Account" no matter how the --scopes flag is
 * spelled. There is no flag that fixes it; the client is the problem.
 *
 * A service account has no consent screen at all. Authorization happens inside
 * GA instead: you add the service account's email as a property user, the same
 * way you would add a colleague. That also makes it auditable in the place
 * someone would actually look — GA4 Admin → Property access management.
 *
 * The JWT-bearer exchange below is hand-rolled against node:crypto rather than
 * pulled from google-auth-library on purpose. This is an AGPL project a stranger
 * clones and self-hosts; a ~25-line signed assertion is a smaller cost to them
 * than a transitive dependency tree added for one setup script.
 */
async function getToken(): Promise<string> {
  if (process.env.GA_ACCESS_TOKEN) return process.env.GA_ACCESS_TOKEN;

  const keyPath = arg("key") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) return serviceAccountToken(keyPath);

  // Last resort. Works only if the caller somehow already holds the scope —
  // which the default gcloud client cannot grant (see above).
  try {
    return execFileSync(
      "gcloud",
      ["auth", "application-default", "print-access-token"],
      { encoding: "utf8", shell: process.platform === "win32" },
    ).trim();
  } catch {
    fail(
      "no credentials.\n" +
        "  Use a service account — gcloud ADC cannot grant analytics.edit:\n\n" +
        "    1. gcloud services enable analyticsadmin.googleapis.com\n" +
        "    2. Create a service account + JSON key in the same project\n" +
        "    3. GA4 Admin → Property access management → add the service\n" +
        "       account's ...iam.gserviceaccount.com email as Administrator\n" +
        "    4. npx tsx scripts/setup-ga4.ts --key=path/to/key.json --property=<id>\n\n" +
        "  Step 3 is the one people skip. A key with no GA property grant\n" +
        "  authenticates fine and then 403s on every call.",
    );
  }
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

async function serviceAccountToken(keyPath: string): Promise<string> {
  let key: { client_email?: string; private_key?: string };
  try {
    key = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch (err) {
    fail(`could not read the service account key at ${keyPath}: ${String(err)}`);
  }
  if (!key.client_email || !key.private_key) {
    fail(
      `${keyPath} is not a service account key.\n` +
        "  Expected JSON with client_email and private_key. An OAuth CLIENT\n" +
        "  secret file looks similar and is not the same thing.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/analytics.edit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  )}.${b64url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(key.private_key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${b64url(signature)}`,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    fail(
      `token exchange failed (${res.status}): ${body.error_description ?? JSON.stringify(body)}\n` +
        "  If this says the API is not enabled, run:\n" +
        "    gcloud services enable analyticsadmin.googleapis.com --project=<project>",
    );
  }
  return body.access_token;
}

function fail(msg: string): never {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
}

let created = 0;
let skipped = 0;

async function api(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<any> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // 403 here is nearly always GA-property permissions rather than the token
    // being wrong, and the raw Google error does not say so. Say it.
    const hint =
      res.status === 403
        ? "\n         403 usually means the consenting account lacks Editor/Administrator" +
          "\n         ON THE GA4 PROPERTY (Admin → Property access management), or the" +
          "\n         Analytics Admin API is not enabled on the ADC quota project."
        : res.status === 404
          ? "\n         404 usually means GA4_PROPERTY_ID is wrong — it is the NUMERIC id," +
            "\n         not the G-XXXXXXXX measurement id."
          : "";
    fail(`${res.status} ${res.statusText} on ${url}\n         ${text}${hint}`);
  }
  return text ? JSON.parse(text) : {};
}

let bearer = "";

// ── Steps ───────────────────────────────────────────────────────────────────

async function customDimensions(): Promise<void> {
  console.log("\n§1 custom dimensions (event-scoped)");
  const existing = await api(`${ADMIN_V1}/properties/${propertyId}/customDimensions`);
  const have = new Set<string>(
    (existing.customDimensions ?? []).map((d: any) => d.parameterName),
  );

  for (const d of CUSTOM_DIMENSIONS) {
    if (have.has(d.parameterName)) {
      console.log(`  SKIP  ${d.parameterName} — already registered`);
      skipped++;
      continue;
    }
    if (!apply) {
      console.log(`  PLAN  ${d.parameterName} → "${d.displayName}"`);
      continue;
    }
    await api(`${ADMIN_V1}/properties/${propertyId}/customDimensions`, {
      method: "POST",
      body: {
        parameterName: d.parameterName,
        displayName: d.displayName,
        description: d.description,
        scope: "EVENT",
      },
    });
    console.log(`  OK    ${d.parameterName} registered`);
    created++;
  }
}

async function keyEvents(): Promise<void> {
  console.log("\n§2 key events");
  const existing = await api(`${ADMIN_V1}/properties/${propertyId}/keyEvents`);
  const have = new Set<string>(
    (existing.keyEvents ?? []).map((k: any) => k.eventName),
  );

  if (have.has(NOT_A_KEY_EVENT)) {
    // Worth flagging loudly rather than silently fixing: un-marking it is a
    // judgement call about someone else's property, and it may have been done
    // deliberately.
    console.log(
      `  WARN  ${NOT_A_KEY_EVENT} is marked as a key event. It is a funnel step,` +
        "\n        not a goal — leaving it marked makes the conversion figure mix" +
        "\n        started checkouts with completed sales. Unmark it in the console.",
    );
  }

  for (const name of KEY_EVENTS) {
    if (have.has(name)) {
      console.log(`  SKIP  ${name} — already a key event`);
      skipped++;
      continue;
    }
    if (!apply) {
      console.log(`  PLAN  ${name} → key event`);
      continue;
    }
    await api(`${ADMIN_V1}/properties/${propertyId}/keyEvents`, {
      method: "POST",
      body: { eventName: name, countingMethod: "ONCE_PER_EVENT" },
    });
    console.log(`  OK    ${name} marked as key event`);
    created++;
  }
}

async function googleSignals(): Promise<void> {
  console.log("\n§3 google signals");
  const cur = await api(
    `${ADMIN_V1A}/properties/${propertyId}/googleSignalsSettings`,
  );
  if (cur.state === "GOOGLE_SIGNALS_DISABLED") {
    console.log("  SKIP  already disabled");
    skipped++;
    return;
  }
  if (!apply) {
    console.log(`  PLAN  ${cur.state ?? "unknown"} → GOOGLE_SIGNALS_DISABLED`);
    return;
  }
  await api(
    `${ADMIN_V1A}/properties/${propertyId}/googleSignalsSettings?updateMask=state`,
    { method: "PATCH", body: { state: "GOOGLE_SIGNALS_DISABLED" } },
  );
  console.log("  OK    disabled");
  created++;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!propertyId) {
    fail(
      "no property id.\n" +
        "  Pass --property=<numeric-id> or set GA4_PROPERTY_ID.\n" +
        "  Find it under GA4 Admin → Property settings. It is NOT the G-XXXXXXXX id.",
    );
  }
  if (!/^\d+$/.test(propertyId)) {
    fail(
      `property id "${propertyId}" is not numeric.\n` +
        "  This is almost certainly the G-XXXXXXXX measurement id, which is a\n" +
        "  different identifier. The Admin API wants the numeric property id.",
    );
  }

  bearer = await getToken();

  console.log(
    `\nGA4 setup — property ${propertyId} — ${apply ? "APPLY" : "DRY RUN (pass --apply to write)"}`,
  );

  await customDimensions();
  await keyEvents();
  await googleSignals();

  console.log(
    `\n${apply ? `${created} created, ${skipped} already present.` : "Dry run — nothing written."}`,
  );
  console.log(
    "\nStill console-only (no API exists for these):\n" +
      "  1. Unwanted referrals → add checkout.stripe.com   ← highest value on the list\n" +
      "  2. Internal traffic definition (IP rules), then set its data filter Active\n" +
      "  3. Search Console link\n" +
      "  4. Reporting identity → device-based\n" +
      "See docs/Analytics.md for the click paths.\n",
  );
}

main().catch((err) => fail(String(err)));
