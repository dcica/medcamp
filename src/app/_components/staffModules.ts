/**
 * Staff-facing module index (platform build order). Surfaced only to signed-in
 * members via the SiteHeader menu — not on the public landing page. "ready"
 * modules link out; "soon" ones render disabled.
 */
export type StaffModule = {
  n: number;
  name: string;
  href: string;
  ready: boolean;
};

export const STAFF_MODULES: StaffModule[] = [
  { n: 1, name: "Registration Portal", href: "/register", ready: true },
  { n: 2, name: "Check-In & Badge", href: "/checkin", ready: true },
  { n: 3, name: "Station Queue", href: "/station", ready: true },
  { n: 4, name: "Coordinator Dashboard", href: "/dashboard", ready: true },
  { n: 5, name: "Supply Calculator", href: "#", ready: false },
  { n: 6, name: "Checklist Module", href: "#", ready: false },
  { n: 7, name: "Lab Tracking & Patient Portal", href: "#", ready: false },
  { n: 8, name: "Venue Config", href: "#", ready: false },
  { n: 9, name: "Volunteer Module", href: "/volunteer", ready: true },
];
