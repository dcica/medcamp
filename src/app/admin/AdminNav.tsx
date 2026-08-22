"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview", coordinatorOnly: false },
  { href: "/admin/camps", label: "Camps & events", coordinatorOnly: false },
  { href: "/admin/performances", label: "Performances", coordinatorOnly: false },
  { href: "/admin/members", label: "Members", coordinatorOnly: true },
  { href: "/admin/membership", label: "Membership", coordinatorOnly: true },
  { href: "/admin/email", label: "Email", coordinatorOnly: true },
  { href: "/admin/settings", label: "Settings", coordinatorOnly: true },
];

export function AdminNav({ isCoordinator }: { isCoordinator: boolean }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.coordinatorOnly || isCoordinator);

  return (
    // WRAPS, never scrolls horizontally. This was `overflow-x-auto`, which at
    // 375px hid 345px of itself — Membership, Email and Settings sat past the
    // right edge with no scroll cue, on every admin page. Content that is
    // present, reachable and invisible is the exact failure the phone-first
    // rule exists to prevent, and it was in the admin shell itself.
    <nav className="-mx-4 mb-6 flex flex-wrap gap-1 border-b border-gray-200 px-4">
      {links.map((l) => {
        const active =
          l.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`min-h-tap whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-brand text-brand"
                : "border-transparent text-gray-500"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
