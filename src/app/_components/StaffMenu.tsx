"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { STAFF_MODULES } from "./staffModules";

/**
 * Signed-in staff menu in the top bar. Replaces the old public module index on
 * the home page — the operational tools (registration, check-in, stations,
 * dashboard, admin) now live here, visible only to members. Renders as a
 * dropdown so it stays out of the way on a 6" phone.
 */
export function StaffMenu({
  name,
  isAdmin,
}: {
  name: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-tap items-center gap-1 text-sm font-semibold text-brand"
      >
        Menu
        <span aria-hidden className="text-xs">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg"
        >
          <p className="truncate px-4 py-2 text-xs text-gray-500">
            Signed in as <span className="font-medium text-gray-700">{name}</span>
          </p>

          {/* Admins/coordinators manage camps & events here. Camps and general
              events are the same record (the Event model) — both live under
              Admin → Camps. Hidden for non-admin members. */}
          {isAdmin && (
            <div className="border-t border-gray-100 py-1">
              <Link
                href="/admin/camps"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-tap items-center px-4 py-2 text-sm font-semibold text-brand hover:bg-gray-50"
              >
                Camps &amp; events
                <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Admin
                </span>
              </Link>
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-tap items-center px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
              >
                Admin overview
              </Link>
            </div>
          )}

          <ul className="border-t border-gray-100 py-1">
            {STAFF_MODULES.map((m) =>
              m.ready ? (
                <li key={m.n}>
                  <Link
                    href={m.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex min-h-tap items-center px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
                  >
                    <span className="mr-2 text-gray-400">{m.n}.</span>
                    {m.name}
                  </Link>
                </li>
              ) : (
                <li key={m.n}>
                  <span
                    aria-disabled="true"
                    className="flex min-h-tap items-center px-4 py-2 text-sm text-gray-300"
                  >
                    <span className="mr-2">{m.n}.</span>
                    {m.name}
                    <span className="ml-auto text-xs">soon</span>
                  </span>
                </li>
              ),
            )}
          </ul>
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
