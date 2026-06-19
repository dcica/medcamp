"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview", coordinatorOnly: false },
  { href: "/admin/camps", label: "Camps", coordinatorOnly: false },
  { href: "/admin/members", label: "Members", coordinatorOnly: true },
  { href: "/admin/settings", label: "Settings", coordinatorOnly: true },
];

export function AdminNav({ isCoordinator }: { isCoordinator: boolean }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.coordinatorOnly || isCoordinator);

  return (
    <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 px-4">
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
