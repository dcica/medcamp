"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The upcoming-events rail.
 *
 * A REAL scroll container with CSS scroll snap — not a JS carousel, not a
 * transform slider, no library. That choice buys swipe, keyboard scrolling,
 * screen-reader order and correct behaviour with JS disabled for free, none of
 * which a transform slider gets without being rebuilt.
 *
 * The children are server-rendered <li> cards passed straight through; nothing
 * here fetches. That is why the observer finds them with a selector instead of
 * refs — a ref would force the cards to be client components.
 *
 * There is deliberately NO auto-advance. Rotating a card that carries a live
 * Register button out from under a thumb is how someone pays for the wrong
 * event. If it is ever added it must pause on hover/touch/focus, stop
 * permanently after the first manual interaction, and honour
 * prefers-reduced-motion.
 */

const CARDS = ":scope > li";

export function EventRail({
  labels,
  children,
}: {
  /** One per card, in order — the accessible name of each dot. */
  labels: string[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  // One event is not a rail. No dots, no snap, no scroll affordance — just the
  // card, so the page does not imply there is more to see than there is.
  const isRail = labels.length > 1;

  useEffect(() => {
    const root = ref.current;
    if (!root || !isRail) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(CARDS));

    // Recompute from ALL cards rather than trusting the last entry to fire.
    // When several are on screen at once — which is every card at once on a
    // wide window that then narrows — "last one seen wins" left the readout
    // pointing at card 5 while the rail still sat at card 1. The card whose
    // leading edge is nearest the scroll origin is the one a reader would call
    // current, and that stays true however many are visible.
    const sync = () => {
      const origin = root.getBoundingClientRect().left;
      let best = 0;
      let bestGap = Infinity;
      cards.forEach((c, i) => {
        const gap = Math.abs(c.getBoundingClientRect().left - origin);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      setActive(best);
    };

    const io = new IntersectionObserver(sync, { root, threshold: 0.6 });
    cards.forEach((c) => io.observe(c));
    // Scroll catches flings the observer's coarse threshold can sit through;
    // resize is the case that produced the stale readout described above.
    root.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      io.disconnect();
      root.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [isRail]);

  function show(i: number) {
    const card = ref.current?.querySelectorAll<HTMLElement>(CARDS)[i];
    if (!card) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  if (!isRail) {
    return <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</ul>;
  }

  return (
    <div>
      {/* -mx-4/px-4 lets the first card sit flush with the page gutter while the
          last one can still scroll clear of it. globals.css pins
          `body { overflow-x: hidden }`, so the negative margin cannot create
          PAGE scroll; an inner overflow-x-auto is unaffected by it.
          tabIndex makes the container focusable, which is what lets arrow keys
          scroll it. On sm: the same cards become a grid and the scroller and its
          position readout both go away. */}
      <ul
        ref={ref}
        tabIndex={0}
        aria-label="Upcoming events"
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2
                   [scroll-padding-inline-start:1rem]
                   sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {children}
      </ul>

      {/* A POSITION READOUT, not the control. The scroller is the control; these
          follow it, and tapping one is a shortcut rather than the only way in.
          48px targets around an 8px dot. */}
      <div className="mt-1 flex justify-center sm:hidden">
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => show(i)}
            aria-label={`Show ${label}`}
            aria-current={i === active ? "true" : undefined}
            className="flex min-h-tap min-w-tap items-center justify-center"
          >
            <span
              aria-hidden
              className={
                i === active
                  ? "h-2 w-2 rounded-full bg-brand"
                  : "h-2 w-2 rounded-full bg-gray-300"
              }
            />
          </button>
        ))}
      </div>
    </div>
  );
}
