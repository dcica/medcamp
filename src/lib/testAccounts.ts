import type { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * TEST-ONLY credential login. This is a back door past OIDC for QA / committee
 * demos / preview deployments, so it is OFF unless TEST_LOGIN_ENABLED=true and is
 * password-gated. NEVER enable it in a real production tenant — it lets anyone
 * with the shared password assume any role.
 *
 * One canonical username per role. Passwords are NOT per-account: a single
 * shared TEST_LOGIN_PASSWORD (env) guards the whole screen.
 */

/**
 * The password this file used to fall back to when TEST_LOGIN_PASSWORD was
 * unset. It is published in the tracked `.env.example`, so it is a PUBLIC
 * string, and it is kept here for exactly one reason: to refuse it.
 */
const PUBLISHED_DEFAULT = "camp-test";

export type TestLoginGate =
  | { enabled: true; password: string; warning?: string }
  | { enabled: false; reason: string };

/**
 * Whether the back door opens, as a PURE FUNCTION of the two env values.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO CONSTS. It used to be
 * `env.TEST_LOGIN_PASSWORD ?? "camp-test"`, which fails OPEN: setting
 * TEST_LOGIN_ENABLED=true and forgetting the password left an unauthenticated
 * path to a COORDINATOR session guarded by a string printed in the public repo.
 * Nothing could catch that, because a module-level const computed from
 * `process.env` cannot be exercised by a verification script. As a predicate it
 * can be, and scripts/verify-testlogin.ts pins every branch.
 *
 * IT GATES ON PRESENCE, NOT LENGTH, AND THAT IS DELIBERATE. A length floor
 * (">= 16 chars") is the obvious hardening and it is the wrong call here: the
 * deployed test environment has had a TEST_LOGIN_PASSWORD set for 66 days, it is
 * a Vercel *Sensitive* variable so nobody — including the maintainer — can read
 * it back, and a length gate would therefore silently switch off a working QA
 * login with no way to predict it. Refusing absent-or-published closes the
 * actual hole; a short password gets a loud warning instead of a locked door.
 */
export function resolveTestLogin(input: {
  enabled: string | undefined;
  password: string | undefined;
}): TestLoginGate {
  if (input.enabled !== "true") {
    return { enabled: false, reason: "TEST_LOGIN_ENABLED is not \"true\"" };
  }
  const password = input.password ?? "";
  if (password.length === 0) {
    return {
      enabled: false,
      reason:
        "TEST_LOGIN_ENABLED=true but TEST_LOGIN_PASSWORD is unset — refusing to " +
        `fall back to the published default ("${PUBLISHED_DEFAULT}" appears in .env.example)`,
    };
  }
  if (password === PUBLISHED_DEFAULT) {
    return {
      enabled: false,
      reason:
        `TEST_LOGIN_PASSWORD is the published default ("${PUBLISHED_DEFAULT}") — ` +
        "set a real one",
    };
  }
  // Set, and not the public string. Open, with a nudge if it is thin.
  return password.length < 16
    ? {
        enabled: true,
        password,
        warning: `TEST_LOGIN_PASSWORD is only ${password.length} characters and guards every role including COORDINATOR`,
      }
    : { enabled: true, password };
}

const gate = resolveTestLogin({
  enabled: env.TEST_LOGIN_ENABLED,
  password: env.TEST_LOGIN_PASSWORD,
});

export const testLoginEnabled = gate.enabled;

/**
 * Shared password for every test account. Empty string when the gate is closed —
 * and `testLoginEnabled` is false in that case, so nothing compares against it.
 * There is no fallback value any more; that was the vulnerability.
 */
export const testLoginPassword = gate.enabled ? gate.password : "";

// Say so at startup. A back door that refused to open, silently, is a support
// ticket ("why does /test-login 404 on staging?"); one that says why is a
// one-line fix. Both branches are worth a line: the closed case explains itself,
// and the open case is a deliberate auth bypass being switched on.
if (!gate.enabled) {
  if (env.TEST_LOGIN_ENABLED === "true") {
    log.warn("test-login: refused to enable", { reason: gate.reason });
  }
} else {
  log.warn("test-login: ENABLED — /test-login can assume any role", {
    ...(gate.warning ? { warning: gate.warning } : {}),
  });
}

export type TestAccount = {
  username: string;
  label: string;
  email: string;
  role: Role;
  canHoldTill: boolean;
  canOverrideWaiver: boolean;
};

export const TEST_ACCOUNTS: TestAccount[] = [
  { username: "coordinator", label: "Coordinator (superuser)", email: "coordinator@dcica.test", role: "COORDINATOR", canHoldTill: true, canOverrideWaiver: true },
  { username: "regdesk", label: "Registration desk — till holder", email: "regdesk@dcica.test", role: "REGISTRATION_TILL", canHoldTill: true, canOverrideWaiver: false },
  { username: "regdesk-notill", label: "Registration desk — no till", email: "regdesk-notill@dcica.test", role: "REGISTRATION_NO_TILL", canHoldTill: false, canOverrideWaiver: false },
  { username: "volunteer", label: "Station volunteer", email: "volunteer@dcica.test", role: "STATION_VOLUNTEER", canHoldTill: false, canOverrideWaiver: false },
  { username: "doctor", label: "Doctor (can add on-site services)", email: "doctor@dcica.test", role: "DOCTOR", canHoldTill: false, canOverrideWaiver: false },
  { username: "pos", label: "POS volunteer — till holder", email: "pos@dcica.test", role: "POS_TILL", canHoldTill: true, canOverrideWaiver: false },
  { username: "admin", label: "Committee / admin", email: "admin@dcica.test", role: "COMMITTEE_ADMIN", canHoldTill: false, canOverrideWaiver: false },
  { username: "volcoord", label: "Volunteer coordinator", email: "volcoord@dcica.test", role: "VOLUNTEER_COORDINATOR", canHoldTill: false, canOverrideWaiver: false },
];

export function findTestAccount(username: string): TestAccount | undefined {
  const u = username.trim().toLowerCase();
  return TEST_ACCOUNTS.find((a) => a.username === u);
}
