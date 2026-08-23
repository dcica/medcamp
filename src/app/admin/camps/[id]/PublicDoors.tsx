"use client";

import { useState, useTransition } from "react";
import { setEventDoors } from "../actions";

/**
 * Which public doors an event opens — the `offers*` triple that decides the
 * button set on the public landing page.
 *
 * WHY THIS SCREEN EXISTS. These three columns were reachable only from
 * `prisma/seed-events.ts`. No admin screen read or wrote them, so an event
 * seeded `offersRegistration: false` stayed that way for good, whatever a
 * coordinator did afterwards. That is not hypothetical: the 2026 Festival of
 * Lights was seeded as a free community night, later had a $30 Competition
 * Entry priced against it on the services screen, and the home page went on
 * showing only Volunteer and Vendor — the offering was real, paid for and
 * capped, and simply had no door. The readiness card scored the event green the
 * whole time, because it counts priced services and never asked whether anyone
 * could reach them.
 *
 * Kept apart from EventFlags deliberately. Those four flags change how the
 * registration form BEHAVES once someone is on it; these three decide whether
 * that page is linked at all. Same card would read as one setting group and
 * invite exactly the mix-up above.
 */

type Doors = {
  offersRegistration: boolean;
  offersVolunteers: boolean;
  offersVendors: boolean;
};

const ROWS: { key: keyof Doors; label: string; help: string }[] = [
  {
    key: "offersRegistration",
    label: "Sell to the public",
    help: "Links the priced services on this event from the home page. Off = the services screen still works, but nothing on it is reachable by a member of the public. The wording of the button follows the offerings: entry fees get “Enter a performance”, everything else gets Register / Buy tickets.",
  },
  {
    key: "offersVolunteers",
    label: "Take volunteer signups",
    help: "Shows a Volunteer button and opens the signup form for this event.",
  },
  {
    key: "offersVendors",
    label: "Take vendor registrations",
    help: "Shows a Register as vendor button for booths and sponsors.",
  },
];

export function PublicDoors({ id, initial }: { id: string; initial: Doors }) {
  const [doors, setDoors] = useState<Doors>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await setEventDoors(id, doors);
      setMsg(res.ok ? "Saved." : res.error);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      {ROWS.map((r) => (
        <label key={r.key} className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={doors[r.key]}
            onChange={(e) =>
              setDoors((d) => ({ ...d, [r.key]: e.target.checked }))
            }
          />
          <span>
            <span className="font-medium">{r.label}</span>
            <span className="block text-xs text-gray-500">{r.help}</span>
          </span>
        </label>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save public doors"}
      </button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </div>
  );
}
