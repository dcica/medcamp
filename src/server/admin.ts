import { requireRole } from "@/server/session";

/**
 * Admin portal access. Setup screens are open to coordinators and committee/
 * admins; people/till management and org settings are coordinator-only.
 */
export const ADMIN_ROLES = ["COORDINATOR", "COMMITTEE_ADMIN"] as const;

/** Coordinator or committee/admin (setup screens). */
export function requireAdmin() {
  return requireRole(...ADMIN_ROLES);
}

/** Coordinator only (members, till, org settings). */
export function requireCoordinator() {
  return requireRole("COORDINATOR");
}

/**
 * Volunteer-module management (role config, roster, certificates, outreach).
 * Coordinator + committee/admin + the delegated Volunteer Coordinator role.
 */
export function requireVolunteerCoordinator() {
  return requireRole("COORDINATOR", "COMMITTEE_ADMIN", "VOLUNTEER_COORDINATOR");
}
