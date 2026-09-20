/**
 * Test-login gate check — when the OIDC back door is allowed to open.
 *
 *   npx tsx scripts/verify-testlogin.ts
 *
 * Sibling of verify-gate.ts, which pins the authorization decisions. No database
 * and no network: this covers the `resolveTestLogin` predicate in
 * src/lib/testAccounts.ts, and the fact that the route in front of it is rate
 * limited.
 *
 * WHY THIS EXISTS. `/api/test-login` is a deliberate bypass past OIDC that mints
 * a session for any of eight roles, COORDINATOR included, guarded by one shared
 * password. It is gated on TEST_LOGIN_ENABLED rather than NODE_ENV on purpose,
 * so it can run on a deployed preview — which means the gate is the only thing
 * standing between a public URL and a superuser session.
 *
 * Until 2026-08-25 the password was `env.TEST_LOGIN_PASSWORD ?? "camp-test"`, and
 * `camp-test` is printed in the tracked `.env.example`. Turning the flag on
 * without setting a password therefore opened the door to anyone who had read
 * the repo. Nothing could catch it: both values were module-level consts read
 * from `process.env` at import, which a verification script cannot vary. Making
 * it a predicate is what made this file possible, and §1 is the regression.
 *
 * MUTATION TEST (required by CLAUDE.md — a check that cannot fail is worse than
 * none). Three mutations were applied to `resolveTestLogin`, one at a time, and
 * each was confirmed to turn this script red:
 *
 *   A. Delete the `password === PUBLISHED_DEFAULT` refusal.        → 3 of 35 FAIL
 *   B. Also change `?? ""` to `?? PUBLISHED_DEFAULT`, restoring
 *      the original vulnerability whole.                          → 7 of 35 FAIL
 *   C. Loosen the flag test to `enabled?.toLowerCase().trim()`.    → 3 of 35 FAIL
 *      (§2: "TRUE", "True" and " true" start opening the door.)
 *
 * A FOURTH MUTATION WAS TRIED FIRST AND DID NOT FAIL, which is the part worth
 * recording. Changing only `?? ""` to `?? PUBLISHED_DEFAULT` — the exact line
 * that WAS the bug — leaves every check green, because an absent password then
 * becomes "camp-test" and the very next branch refuses it by name. The two
 * refusals cover each other, so no single edit to either one reopens the hole.
 * That is the design working, and it is also a reminder that a mutation which
 * fails to fail does not prove the suite is weak — but an UNVERIFIED claimed
 * mutation would have been exactly the dead check this rule exists to prevent.
 */
import { readFileSync } from "node:fs";
import { resolveTestLogin, TEST_ACCOUNTS, findTestAccount } from "../src/lib/testAccounts";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

console.log("\n§1 the gate fails CLOSED, never back to the published default");
// The vulnerability, stated as a test: flag on, password missing.
const missing = resolveTestLogin({ enabled: "true", password: undefined });
check(
  "flag on + password unset ⇒ CLOSED",
  missing.enabled === false,
  missing.enabled ? "THE BACK DOOR IS OPEN WITH NO PASSWORD SET" : "",
);
const blank = resolveTestLogin({ enabled: "true", password: "" });
check("flag on + password empty ⇒ CLOSED", blank.enabled === false);
// The published string is refused even when set explicitly — someone copying
// .env.example into a deployed environment must not get a working back door.
const published = resolveTestLogin({ enabled: "true", password: "camp-test" });
check(
  "flag on + password is the published default ⇒ CLOSED",
  published.enabled === false,
  published.enabled ? "camp-test WAS ACCEPTED" : "",
);
// Whatever the gate resolves to must never be the public string.
for (const p of [undefined, "", "camp-test"]) {
  const g = resolveTestLogin({ enabled: "true", password: p });
  check(
    `resolved password is not the published default (input: ${JSON.stringify(p)})`,
    !(g.enabled && g.password === "camp-test"),
  );
}

console.log("\n§2 the flag itself must be exactly \"true\"");
// A boolean read from a string env var is a classic near-miss: "TRUE", "1" and
// "yes" all look enabling to a human and must not be.
for (const v of [undefined, "", "false", "TRUE", "True", "1", "yes", "on", " true"]) {
  const g = resolveTestLogin({ enabled: v, password: "a-real-long-password" });
  check(`enabled=${JSON.stringify(v)} ⇒ CLOSED`, g.enabled === false);
}
const on = resolveTestLogin({ enabled: "true", password: "a-real-long-password" });
check("enabled=\"true\" + a real password ⇒ OPEN", on.enabled === true);
check(
  "…and it carries that exact password through",
  on.enabled === true && on.password === "a-real-long-password",
);

console.log("\n§3 a short password warns but does NOT lock out");
// Deliberate: the deployed test env has had a password set for 66 days, stored
// as a Vercel *Sensitive* variable that nobody can read back. A length floor
// would silently switch off a working QA login with no way to predict it.
const short = resolveTestLogin({ enabled: "true", password: "short1" });
check("a 6-char password still opens the gate", short.enabled === true);
check(
  "…and carries a warning",
  short.enabled === true && typeof short.warning === "string" && short.warning.length > 0,
  short.enabled === true ? short.warning ?? "(none)" : "",
);
const long = resolveTestLogin({ enabled: "true", password: "x".repeat(32) });
check("a 32-char password opens with no warning", long.enabled === true && !long.warning);

console.log("\n§4 the closed cases explain themselves");
// A back door that refuses to open silently is a support ticket. Each closed
// branch must say which of the three reasons applied.
for (const [label, g] of [
  ["flag off", resolveTestLogin({ enabled: "false", password: "p".repeat(20) })],
  ["password unset", missing],
  ["published default", published],
] as const) {
  check(
    `${label} ⇒ non-empty reason`,
    g.enabled === false && typeof g.reason === "string" && g.reason.length > 10,
    g.enabled === false ? g.reason : "(gate was open)",
  );
}

console.log("\n§5 the account table is intact");
check("eight canonical accounts", TEST_ACCOUNTS.length === 8, String(TEST_ACCOUNTS.length));
check("usernames are unique", new Set(TEST_ACCOUNTS.map((a) => a.username)).size === 8);
check("emails are unique", new Set(TEST_ACCOUNTS.map((a) => a.email)).size === 8);
check("lookup is case- and space-insensitive", findTestAccount("  COORDINATOR ")?.role === "COORDINATOR");
check("an unknown username resolves to nothing", findTestAccount("root") === undefined);
// Only the coordinator should be able to waive a waiver AND hold a till.
const coord = findTestAccount("coordinator");
check(
  "coordinator is the superuser account",
  coord?.role === "COORDINATOR" && coord.canHoldTill === true && coord.canOverrideWaiver === true,
);
check(
  "no non-coordinator account can override a waiver",
  TEST_ACCOUNTS.filter((a) => a.canOverrideWaiver).every((a) => a.role === "COORDINATOR"),
);

console.log("\n§6 the route in front of the gate is rate limited");
// One shared password with no lockout is brute-forceable, and the screen in
// front of it publishes all eight usernames. The limiter is the only bound, so
// its absence is a finding — assert it by reading the route.
const route = readFileSync("src/app/api/test-login/route.ts", "utf8");
check(
  "the route imports the request guard",
  /from "@\/server\/requestGuard"/.test(route),
);
const guardCall = route.match(/guard\(\s*"test-login"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
check("it guards on a \"test-login\" bucket", Boolean(guardCall), guardCall ? guardCall[0] : "no guard() call found");
if (guardCall) {
  const [, limit, window] = guardCall;
  check(
    `the limit is tight enough to matter (${limit} per ${window}s)`,
    Number(limit) <= 20 && Number(window) >= 300,
    `${limit}/${window}s`,
  );
}
check(
  "a refusal answers 429, not 401 (a blocked tester is not a wrong password)",
  /status:\s*429/.test(route),
);
// The guard must run BEFORE the password comparison, or it bounds nothing.
const guardAt = route.indexOf('guard("test-login"');
const compareAt = route.indexOf("password !== testLoginPassword");
check(
  "the guard runs before the password is compared",
  guardAt !== -1 && compareAt !== -1 && guardAt < compareAt,
  guardAt === -1 || compareAt === -1 ? "one of the two was not found" : "",
);

console.log(
  failures === 0
    ? `\nAll checks passed. (${checks} assertions)\n`
    : `\n${failures} of ${checks} CHECK(S) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
