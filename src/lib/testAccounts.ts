import type { Role } from "@prisma/client";
import { env } from "@/lib/env";

/**
 * TEST-ONLY credential login. This is a back door past OIDC for QA / committee
 * demos / preview deployments, so it is OFF unless TEST_LOGIN_ENABLED=true and is
 * password-gated. NEVER enable it in a real production tenant — it lets anyone
 * with the shared password assume any role.
 *
 * One canonical username per role. Passwords are NOT per-account: a single
 * shared TEST_LOGIN_PASSWORD (env) guards the whole screen.
 */

export const testLoginEnabled = env.TEST_LOGIN_ENABLED === "true";

/** Shared password for every test account. Override via env; dev fallback only. */
export const testLoginPassword = env.TEST_LOGIN_PASSWORD ?? "camp-test";

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
