import type { EventStatus } from "@prisma/client";
import {
  LIFECYCLE_RAIL,
  railPositionOf,
  stageLabel,
} from "@/lib/eventLifecycle";

/**
 * Where an event sits in its life: five segments, passed ones filled, the
 * current one highlighted, the rest neutral.
 *
 * WHY A RAIL AND NOT A PILL. `OPEN` on its own says where the event is and
 * nothing about where it is going. A coordinator reading one word has to
 * remember the order of a six-state machine to know whether anything is
 * overdue. The rail shows the whole path with a mark on it, which is the same
 * information the pill carried plus the part that was missing.
 *
 * DISPLAY ONLY. There is no transition here on purpose — moving an event
 * between states is consequential (opening it puts it on a public page; purging
 * destroys patient records behind a `window.confirm`) and belongs on camp
 * detail next to the sentence explaining what the move turns on. A tappable
 * rail on an overview would put a one-tap purge on the first screen after
 * sign-in.
 *
 * Shared with the camp-detail redesign; that screen renders the same component
 * above its own lifecycle controls rather than drawing a second rail.
 */
export function LifecycleRail({ status }: { status: EventStatus }) {
  const current = railPositionOf(status);

  return (
    <div>
      {/*
        One label for a screen reader instead of five disconnected words — read
        aloud, "DRAFT OPEN ACTIVE CLOSED PURGED" gives no indication of which
        one this event is in, because the state lives entirely in the colors.
      */}
      <div
        role="img"
        aria-label={`Lifecycle: ${status}, step ${current + 1} of ${LIFECYCLE_RAIL.length}`}
        className="flex gap-1"
      >
        {LIFECYCLE_RAIL.map((stage, i) => (
          <span
            key={stage.label}
            aria-hidden
            className={`h-1.5 flex-1 rounded-full ${
              i < current
                ? "bg-brand"
                : i === current
                  ? "bg-accent"
                  : "bg-gray-200"
            }`}
          />
        ))}
      </div>
      <div aria-hidden className="mt-2 flex justify-between gap-1">
        {LIFECYCLE_RAIL.map((stage, i) => (
          <span
            key={stage.label}
            className={`text-[11px] font-semibold uppercase tracking-wide ${
              i === current ? "text-brand" : "text-gray-400"
            }`}
          >
            {stageLabel(stage, status)}
          </span>
        ))}
      </div>
    </div>
  );
}
