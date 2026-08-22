import type { Role } from "@prisma/client";

/**
 * Staff navigation: where each role can go, and where it lands after sign-in.
 *
 * Replaces the old STAFF_MODULES list, which shipped CLAUDE.md's build order
 * verbatim ("1. Registration Portal … 9. Volunteer Module") with a `ready` flag
 * that rendered four unbuilt entries as disabled `#` links. Measured on test,
 * every role saw the same nine rows: four of them unlabeled in the
 * accessibility tree, and one ("Coordinator Dashboard") that 403s five of the
 * eight roles. Meanwhile /gate — reachable by two roles — was absent entirely.
 *
 * TWO RULES, both load-bearing:
 *
 * 1. **Membership is filtered, never styling.** If a destination does not exist,
 *    or this user cannot reach it, it is not in the list. No disabled rows, no
 *    "soon". A greyed-out row spends the user's attention on work they cannot
 *    do, and advertises the roadmap to people trying to run an event.
 *
 * 2. **`roles` MUST mirror the server guard on the page.** This file decides
 *    what is offered; the page decides what is allowed. If they drift, the menu
 *    lies again — which is the exact defect this replaces. scripts/verify-roles.ts
 *    asserts every offered destination is reachable by the role it was offered to.
 *
 * COORDINATOR is deliberately absent from most `roles` arrays: requireRole()
 * treats it as a superuser bypass, and `destinationsFor` mirrors that below, so
 * listing it on every entry would be noise that can fall out of step.
 */
export type StaffDestination = {
  href: string;
  name: string;
  /**
   * Roles the page's own guard admits, COORDINATOR excluded (see above).
   * Empty array = reachable by any signed-in member.
   */
  roles: Role[];
  /** Renders an "Admin" chip; purely presentational. */
  admin?: boolean;
};

/**
 * Mirrors of the server guards, as of 2026-08-21:
 *   /register            public
 *   /checkin             REGISTRATION_TILL, REGISTRATION_NO_TILL, STATION_VOLUNTEER
 *   /station             STATION_VOLUNTEER, DOCTOR
 *   /gate                REGISTRATION_TILL, REGISTRATION_NO_TILL, STATION_VOLUNTEER, POS_TILL
 *   /dashboard           COORDINATOR, COMMITTEE_ADMIN
 *   /volunteers          COORDINATOR, COMMITTEE_ADMIN, VOLUNTEER_COORDINATOR
 *   /volunteer/checkin   VOLUNTEER_COORDINATOR, COMMITTEE_ADMIN, STATION_VOLUNTEER
 *   /admin*              COORDINATOR, COMMITTEE_ADMIN
 */
export const STAFF_DESTINATIONS: StaffDestination[] = [
  {
    href: "/dashboard",
    name: "Event dashboard",
    roles: ["COMMITTEE_ADMIN"],
  },
  {
    href: "/register",
    name: "Register a guest",
    roles: ["REGISTRATION_TILL", "REGISTRATION_NO_TILL"],
  },
  {
    href: "/checkin",
    name: "Check in",
    roles: ["REGISTRATION_TILL", "REGISTRATION_NO_TILL", "STATION_VOLUNTEER"],
  },
  {
    // Absent from the old menu entirely, despite four roles being able to use it.
    href: "/gate",
    name: "Gate",
    roles: [
      "REGISTRATION_TILL",
      "REGISTRATION_NO_TILL",
      "STATION_VOLUNTEER",
      "POS_TILL",
    ],
  },
  {
    href: "/station",
    name: "My station",
    roles: ["STATION_VOLUNTEER", "DOCTOR"],
  },
  {
    // The coordinator ROSTER. The old menu offered only /volunteer — the public
    // signup form — under the label "Volunteer Module", which reads like this.
    href: "/volunteers",
    name: "Volunteer roster",
    roles: ["COMMITTEE_ADMIN", "VOLUNTEER_COORDINATOR"],
  },
  {
    href: "/volunteer/checkin",
    name: "Volunteer sign in/out",
    roles: ["VOLUNTEER_COORDINATOR", "COMMITTEE_ADMIN", "STATION_VOLUNTEER"],
  },
  {
    href: "/admin/camps",
    name: "Camps & events",
    roles: ["COMMITTEE_ADMIN"],
    admin: true,
  },
  {
    href: "/admin/performances",
    name: "Performance entries",
    roles: ["COMMITTEE_ADMIN"],
    admin: true,
  },
  {
    href: "/admin",
    name: "Admin overview",
    roles: ["COMMITTEE_ADMIN"],
    admin: true,
  },
];

/**
 * What this role may open. Mirrors requireRole's COORDINATOR superuser bypass
 * (src/server/session.ts) — a coordinator sees everything, everyone else sees
 * only what their own guard admits.
 */
export function destinationsFor(role: Role): StaffDestination[] {
  if (role === "COORDINATOR") return STAFF_DESTINATIONS;
  return STAFF_DESTINATIONS.filter(
    (d) => d.roles.length === 0 || d.roles.includes(role),
  );
}

/**
 * Where sign-in sends this role.
 *
 * Previously everyone was sent to a fixed destination, so `volunteer`,
 * `regdesk` and `volcoord` all authenticated successfully and landed on /403 —
 * the first screen a volunteer saw on event day.
 *
 * Every route below is one the role's own guard admits, so this can never
 * bounce. verify-roles.ts pins that.
 */
export function landingRouteFor(role: Role): string {
  switch (role) {
    case "COORDINATOR":
    case "COMMITTEE_ADMIN":
      return "/dashboard";
    case "REGISTRATION_TILL":
    case "REGISTRATION_NO_TILL":
      return "/register";
    case "STATION_VOLUNTEER":
    case "DOCTOR":
      return "/station";
    case "POS_TILL":
      return "/gate";
    case "VOLUNTEER_COORDINATOR":
      return "/volunteers";
  }
}
