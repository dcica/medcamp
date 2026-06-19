import type { Role } from "@prisma/client";

/** The 8 tenant-scoped roles (CLAUDE.md access table), with UI labels. */
export const ROLES: { value: Role; label: string }[] = [
  { value: "COORDINATOR", label: "Coordinator" },
  { value: "REGISTRATION_TILL", label: "Registration desk — till" },
  { value: "REGISTRATION_NO_TILL", label: "Registration desk — no till" },
  { value: "STATION_VOLUNTEER", label: "Station volunteer" },
  { value: "DOCTOR", label: "Doctor" },
  { value: "POS_TILL", label: "POS volunteer — till" },
  { value: "COMMITTEE_ADMIN", label: "Committee / admin" },
  { value: "VOLUNTEER_COORDINATOR", label: "Volunteer coordinator" },
];

export function roleLabel(role: Role): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}
