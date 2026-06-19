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
