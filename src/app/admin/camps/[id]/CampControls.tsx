"use client";

import { useState, useTransition } from "react";
import type { EventStatus } from "@prisma/client";
import { transitionCamp, setWalkIn } from "../actions";

const NEXT: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["ACTIVE", "DRAFT"],
  ACTIVE: ["CLOSED"],
  CLOSED: ["PURGEABLE"],
  PURGEABLE: ["PURGED"],
  PURGED: [],
};

const LABEL: Record<EventStatus, string> = {
  DRAFT: "Back to draft",
  OPEN: "Open registration",
  ACTIVE: "Start day-of",
  CLOSED: "Close camp",
  PURGEABLE: "Mark purgeable",
  PURGED: "Purge patient data",
};

export function CampControls({
  id,
  status,
  walkInOpen,
}: {
  id: string;
  status: EventStatus;
  walkInOpen: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const targets = NEXT[status];

  function move(target: EventStatus) {
    if (target === "PURGED") {
      const ok = window.confirm(
        "This permanently deletes all patient names and addresses for this camp. Anonymous counts and consented contacts are kept. This cannot be undone. Continue?",
      );
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const res = await transitionCamp(id, target);
      if (!res.ok) setError(res.error);
    });
  }

  function toggleWalkIn() {
    setError(null);
    startTransition(async () => {
      const res = await setWalkIn(id, !walkInOpen);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => (
          <button
            key={t}
            type="button"
            disabled={pending}
            onClick={() => move(t)}
            className={`min-h-tap rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
              t === "PURGED"
                ? "bg-red-600 text-white"
                : t === "DRAFT"
                  ? "border border-gray-300 text-gray-600"
                  : "bg-brand text-brand-fg"
            }`}
          >
            {LABEL[t]}
          </button>
        ))}
        {targets.length === 0 && (
          <p className="text-sm text-gray-500">No further transitions.</p>
        )}
      </div>

      {status === "ACTIVE" && (
        <button
          type="button"
          disabled={pending}
          onClick={toggleWalkIn}
          className="min-h-tap w-full rounded-lg border border-gray-300 text-sm font-medium disabled:opacity-50"
        >
          {walkInOpen ? "Close walk-in registration" : "Open walk-in registration"}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
