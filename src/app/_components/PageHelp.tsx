"use client";

import { useEffect, useState } from "react";

export type HelpItem = {
  /** The field, control, or section this tip is about. */
  label: string;
  /** A short, plain-language explanation. */
  body: string;
};

/**
 * Inline page help. Renders a "?" toggle in the page header; clicking it reveals
 * a panel of contextual tips keyed to the page's fields and sections. Hidden by
 * default. The open/closed choice is remembered per page (localStorage) so a
 * volunteer who opens help once keeps it across visits to the same screen.
 *
 * Two modes:
 *  - title given  → renders the page heading (h1 + optional subtitle) with the
 *    toggle aligned to the right of the title.
 *  - title omitted → renders just a right-aligned toggle + panel, to slot under
 *    a page's own bespoke header (e.g. dashboard, station queue).
 */
export function PageHelp({
  id,
  title,
  subtitle,
  items,
}: {
  /** Stable key for remembering the open/closed state. */
  id: string;
  title?: string;
  subtitle?: string;
  items: HelpItem[];
}) {
  const storageKey = `help:${id}`;
  const [open, setOpen] = useState(false);

  // Read the remembered preference after mount (avoids a hydration mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "1") setOpen(true);
    } catch {
      /* private mode / no storage — default closed */
    }
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className="inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-sm font-medium text-gray-600"
    >
      <span
        aria-hidden
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-fg"
      >
        ?
      </span>
      {open ? "Hide help" : "Help"}
    </button>
  );

  const panel = open && (
    <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">
        About this page
      </p>
      <ul className="mt-2 space-y-3">
        {items.map((it, i) => (
          <li key={i} className="text-sm">
            <span className="font-semibold text-gray-800">
              <span aria-hidden className="mr-1.5 text-brand">
                ⓘ
              </span>
              {it.label}
            </span>
            <p className="ml-5 mt-0.5 text-gray-600">{it.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );

  if (title) {
    return (
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
            )}
          </div>
          {button}
        </div>
        {panel}
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end">{button}</div>
      {panel}
    </div>
  );
}
