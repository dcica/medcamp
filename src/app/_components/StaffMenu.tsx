"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Role } from "@prisma/client";
import { destinationsFor } from "./staffNav";

/**
 * Signed-in staff menu in the top bar. A dropdown so it stays out of the way on
 * a 6" phone, which is where most of this is used.
 *
 * Lists only what THIS role can open — see src/app/_components/staffNav.ts for
 * the rule and why. Nothing here is ever rendered disabled: an entry a user
 * cannot use is removed, not greyed out.
 */
export function StaffMenu({ name, role }: { name: string; role: Role }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const destinations = destinationsFor(role);

  // Close on outside click / Escape so it never traps focus on a phone.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Icon-only, so it costs the same header width whatever it opens — and
          it now opens everything, including what used to be the admin tab bar.
          aria-label carries the name the text label used to. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        className="flex min-h-tap min-w-tap items-center justify-center text-brand"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-6 w-6"
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M3 6h18" />
              <path d="M3 12h18" />
              <path d="M3 18h18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 max-h-[80vh] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg"
        >
          <p className="truncate px-4 py-2 text-xs text-gray-500">
            Signed in as <span className="font-medium text-gray-700">{name}</span>
          </p>

          {(["work", "admin"] as const).map((group) => {
            const items = destinations.filter((d) => d.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="border-t border-gray-100 py-1">
                {/* The heading only earns its line when there is something to
                    separate. A volunteer with two entries gets no headings. */}
                {group === "admin" && (
                  <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Setup
                  </p>
                )}
                <ul>
                  {items.map((d) => {
                    const current =
                      d.href === "/admin"
                        ? pathname === "/admin"
                        : pathname === d.href || pathname.startsWith(d.href + "/");
                    return (
                      <li key={d.href}>
                        <Link
                          href={d.href}
                          role="menuitem"
                          aria-current={current ? "page" : undefined}
                          onClick={() => setOpen(false)}
                          className={`flex min-h-tap items-center px-4 py-2 text-sm hover:bg-gray-50 ${
                            current ? "font-semibold text-brand" : "text-gray-800"
                          }`}
                        >
                          {d.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <div className="border-t border-gray-100 py-1">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex min-h-tap w-full items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
