"use client";

import { useEffect, useRef } from "react";

import { trackViewItem } from "@/lib/analyticsEvents";

/**
 * Fires GA4 `view_item` once, on mount, for the event page it is dropped into.
 *
 * It renders nothing. It exists only because `page.tsx` is a Server Component
 * and must stay one — that page is the org's whole local-search play (see its
 * header) and its metadata, JSON-LD and DB reads all run on the server.
 * Converting it to a client component to fire one analytics event would move
 * the entire page into the bundle to gain nothing.
 *
 * The props are already-resolved primitives rather than the event object: this
 * component is the boundary into the client bundle, and passing the whole row
 * would serialise every column of an event into the page's flight payload —
 * including the ones no visitor needs to see.
 *
 * `valueCents` is deliberately nullable and comes from the same sale summary the
 * page prints a price from, gated by the same `sellable` rule. A page that
 * refuses to print a price must not report one: that rule is why the JSON-LD
 * `offer` is conditional a few lines above the call site, and the funnel's
 * numbers have to agree with the page a person actually read.
 */
export function ViewItemTracker({
  eventSlug,
  eventKind,
  valueCents,
}: {
  eventSlug: string;
  eventKind: string;
  valueCents: number | null;
}) {
  // One event per slug, not one per effect run. React StrictMode invokes effects
  // twice in development, and a soft navigation between two event pages must
  // report two views — so the guard is keyed to the slug rather than a bare
  // "have I run" boolean.
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (fired.current === eventSlug) return;
    fired.current = eventSlug;
    trackViewItem({ eventSlug, eventKind, valueCents });
  }, [eventSlug, eventKind, valueCents]);

  return null;
}
