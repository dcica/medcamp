import Link from "next/link";

/**
 * Where you are, and every step back to the dashboard.
 *
 * WHAT THIS REPLACES. Each admin page carried its own single "← Parent" link,
 * which is one hop and not a trail. Following dashboard → camp → registrations
 * and then pressing back twice landed on /admin/camps, which had NO link back
 * to the dashboard at all — so the chain ended in a dead end one page short of
 * where it started. Each page also chose its own label ("← Camps", "← Dandia
 * Night 2026", "← {camp.name}"), so the same hop was named three ways.
 *
 * The last crumb is the current page and is deliberately NOT a link: a link to
 * where you already are is a control that does nothing, and on a phone it is a
 * 48px target that spends a tap to reload.
 *
 * Rendered as a real <nav aria-label="Breadcrumb"> with an ordered list, which
 * is what a screen reader announces as a breadcrumb trail; the chevrons are
 * aria-hidden so it does not read "Dashboard slash Camps slash".
 */
export type Crumb = {
  label: string;
  /** Omitted on the final crumb — the page you are already on. */
  href?: string;
};

export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-gray-500">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-x-1">
              {i > 0 && (
                <span aria-hidden className="text-gray-300">
                  ›
                </span>
              )}
              {last || !c.href ? (
                // aria-current marks the page for a screen reader without
                // needing the visual weight to carry that meaning alone.
                <span aria-current="page" className="font-medium text-gray-700">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  // Tap targets: 44px of height via py, not a fixed min-h that
                  // would make a wrapped two-line trail enormous on a phone.
                  className="inline-flex items-center py-2 text-brand underline"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The admin trail, built from one place.
 *
 * Every admin camp page passes what it knows and gets the whole chain back, so
 * the hop from /admin/camps to /dashboard cannot go missing on one page and be
 * present on another — which is exactly how it went missing the first time.
 */
export function campTrail(opts: {
  campId?: string;
  campName?: string;
  /** Leaf page under a camp, e.g. "Registrations". */
  leaf?: string;
}): Crumb[] {
  const trail: Crumb[] = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Camps", href: "/admin/camps" },
  ];
  if (opts.campName) {
    trail.push({
      label: opts.campName,
      href: opts.leaf && opts.campId ? `/admin/camps/${opts.campId}` : undefined,
    });
  }
  if (opts.leaf) trail.push({ label: opts.leaf });
  return trail;
}
