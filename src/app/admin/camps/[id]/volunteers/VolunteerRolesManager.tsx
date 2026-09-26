"use client";

import { useState, useTransition } from "react";
import {
  createVolunteerRole,
  saveVolunteerRole,
  deleteVolunteerRole,
  type RoleInput,
} from "./actions";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  minAge: number;
  capacity: number;
  filled: number;
  shift: string | null;
  instructions: string | null;
  requiresClearance: boolean;
  active: boolean;
};

const inputCls =
  "min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base";

/** 0 means "no target set", not "nobody needed" — so it has no shortfall. */
function shortfallOf(r: RoleRow): number {
  return r.capacity > 0 ? Math.max(0, r.capacity - r.filled) : 0;
}

const AGE_LABEL: Record<number, string> = { 0: "Any age", 16: "16+", 18: "18+" };

/**
 * Per-event volunteer roles.
 *
 * WHAT THIS REPLACES. Five roles rendered as five simultaneously-open forms:
 * 41 inputs and 3.5 phone screens for an event with five roles, an Add box
 * below all of it, and instructions clipped mid-sentence by a fixed 3rem
 * textarea. Measured at 390×844 on the deployed test env against Test Camp —
 * Active (Summer 2027).
 *
 * IT IS THE SERVICES SCREEN'S PATTERN, APPLIED. Collapsed rows, one card open
 * at a time, a sticky save bar inside the open card. That screen carries twelve
 * offerings in 1.5 screens for the reason its own comment gives — "twelve
 * simultaneously-expanded cards is what made this screen 9,000px tall on a
 * phone; an accordion is the whole fix" — and the lesson stopped at that file.
 * Nothing here is new; it is that, twice.
 *
 * SHORTFALL LEADS, BECAUSE SHORTFALL IS THE JOB. "3/10 filled" used to render
 * 11px grey in a corner, so Setup / Teardown seven people short looked exactly
 * like Translator two short. Rows now sort by how many people are still
 * missing, carry a fill bar, and tint once the role is under half staffed. The
 * admin overview already blocks an event on "No volunteer roles defined"; this
 * is the same question asked one level down.
 *
 * INACTIVE ROLES SORT LAST whatever their shortfall. A closed role is not
 * recruiting, so its gap is not work — putting it on top would bury a role that
 * is.
 *
 * No server change: `filled` and `capacity` already arrive on RoleRow, and the
 * sort, the bar and the tiles are all arithmetic on the array that was already
 * being rendered.
 */
export function VolunteerRolesManager({
  eventId,
  roles,
}: {
  eventId: string;
  roles: RoleRow[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  const totalTarget = roles.reduce((n, r) => n + Math.max(0, r.capacity), 0);
  const totalFilled = roles.reduce((n, r) => n + r.filled, 0);
  const stillNeeded = roles.reduce((n, r) => n + (r.active ? shortfallOf(r) : 0), 0);

  const ordered = [...roles].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const gap = shortfallOf(b) - shortfallOf(a);
    return gap !== 0 ? gap : a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Three tiles, never four. The fourth is what starts the sideways scroll
          on a 390px screen — the rule RosterSummaryPanel already follows. */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Roles" value={String(roles.length)} />
        <Tile label="Filled" value={`${totalFilled}/${totalTarget}`} />
        <Tile label="Still needed" value={String(stillNeeded)} warn={stillNeeded > 0} />
      </div>

      {/* Add sits ABOVE the list. Below it, adding the sixth role meant
          scrolling past five forms nobody opened this screen to edit. */}
      {adding ? (
        <div className="flex gap-2">
          <input
            className={`flex-1 ${inputCls}`}
            placeholder="New role name (e.g. Greeter)"
            aria-label="New role name"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            disabled={pending || newName.trim() === ""}
            onClick={() =>
              run(async () => {
                const res = await createVolunteerRole(eventId, newName);
                if (res.ok) {
                  setNewName("");
                  setAdding(false);
                }
                return res;
              })
            }
            className="min-h-tap rounded-lg bg-brand px-4 font-semibold text-brand-fg disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
            }}
            className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
        >
          + Add role
        </button>
      )}

      {roles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
          No roles yet. Nobody can sign up to help until this event has at least
          one.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Shortest-staffed first
          </p>
          <ul className="space-y-2">
            {ordered.map((r) => (
              <RoleCard
                key={r.id}
                eventId={eventId}
                row={r}
                open={openId === r.id}
                onToggle={() => setOpenId((p) => (p === r.id ? null : r.id))}
                pending={pending}
                run={run}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white px-3 py-2 ${
        warn ? "border-amber-300" : "border-gray-200"
      }`}
    >
      <div
        className={`text-lg font-bold tabular-nums ${
          warn ? "text-amber-700" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
    </div>
  );
}

/**
 * Collapsed: the three things read without editing — how staffed it is, when
 * the shift runs, and who may sign up. Editing is a deliberate tap.
 */
function RoleCard({
  eventId,
  row,
  open,
  onToggle,
  pending,
  run,
}: {
  eventId: string;
  row: RoleRow;
  open: boolean;
  onToggle: () => void;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const short = shortfallOf(row);
  const pct =
    row.capacity > 0 ? Math.min(100, Math.round((row.filled / row.capacity) * 100)) : 0;
  // Half-staffed is the line. Below it the role needs chasing this week, and a
  // coordinator scanning the list should not have to do the subtraction.
  const urgent = row.active && row.capacity > 0 && pct < 50;

  const meta = [
    row.capacity > 0 ? `${row.filled} of ${row.capacity}` : `${row.filled} signed up`,
    row.shift,
    AGE_LABEL[row.minAge] ?? `${row.minAge}+`,
    row.requiresClearance ? "clearance" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={`overflow-hidden rounded-xl border bg-white ${
        urgent ? "border-amber-300" : "border-gray-200"
      } ${row.active ? "" : "opacity-60"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-tap w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-gray-900">
            {row.name}
            {!row.active && (
              <span className="ml-2 text-xs font-normal text-gray-500">inactive</span>
            )}
          </span>
          <span className="block truncate text-xs text-gray-500">{meta}</span>
          {row.capacity > 0 && (
            <span
              aria-hidden
              className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
            >
              <span
                className={`block h-full rounded-full ${
                  urgent ? "bg-amber-500" : "bg-brand"
                }`}
                style={{ width: `${pct}%` }}
              />
            </span>
          )}
        </span>
        {short > 0 && row.active && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              urgent ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            Short {short}
          </span>
        )}
        <span aria-hidden className="shrink-0 text-gray-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && <RoleEditor eventId={eventId} row={row} pending={pending} run={run} />}
    </li>
  );
}

function RoleEditor({
  eventId,
  row,
  pending,
  run,
}: {
  eventId: string;
  row: RoleRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [f, setF] = useState<RoleInput>({
    name: row.name,
    description: row.description ?? "",
    minAge: row.minAge,
    capacity: row.capacity,
    shift: row.shift ?? "",
    instructions: row.instructions ?? "",
    requiresClearance: row.requiresClearance,
    active: row.active,
  });
  const set = (patch: Partial<RoleInput>) => setF((p) => ({ ...p, ...patch }));

  const dirty =
    f.name !== row.name ||
    f.description !== (row.description ?? "") ||
    f.minAge !== row.minAge ||
    f.capacity !== row.capacity ||
    f.shift !== (row.shift ?? "") ||
    f.instructions !== (row.instructions ?? "") ||
    f.requiresClearance !== row.requiresClearance ||
    f.active !== row.active;

  return (
    <div className="space-y-4 border-t border-gray-100 px-3 pb-3 pt-4">
      <label className="block text-sm text-gray-600">
        Role name
        <input
          className={inputCls}
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <label className="block text-sm text-gray-600">
        Short description
        <input
          className={inputCls}
          placeholder="Shown on the signup form"
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-gray-600">
          Target count
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className={inputCls}
            value={f.capacity}
            onChange={(e) => set({ capacity: Number(e.target.value) })}
          />
          <span className="mt-1 block text-xs text-gray-400">
            {row.filled} signed up so far.
          </span>
        </label>
        <label className="block text-sm text-gray-600">
          Min age
          <select
            className={inputCls}
            value={f.minAge}
            onChange={(e) => set({ minAge: Number(e.target.value) })}
          >
            <option value={0}>Any age</option>
            <option value={16}>16+</option>
            <option value={18}>18+</option>
          </select>
        </label>
      </div>

      <label className="block text-sm text-gray-600">
        Shift
        <input
          className={inputCls}
          placeholder="e.g. 8:00–12:00"
          value={f.shift}
          onChange={(e) => set({ shift: e.target.value })}
        />
      </label>

      {/* rows=4, not a fixed 3rem. Every seeded role's instructions clipped at
          "Wear comfortable shoes;" — the field was shorter than the text the
          seed puts in it, on a screen whose whole job is writing that text. */}
      <label className="block text-sm text-gray-600">
        Instructions
        <textarea
          rows={4}
          className={`${inputCls} leading-relaxed`}
          placeholder="Sent in the confirmation email and shown at day-of sign-in"
          value={f.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
          Open to signups
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.requiresClearance}
            onChange={(e) => set({ requiresClearance: e.target.checked })}
          />
          Training / clearance required
        </label>
      </div>

      {/* THE REASON IS RENDERED, NOT HUNG IN A `title`. A role with signups
          cannot be deleted, and the explanation used to live in a tooltip that
          never appears on a touch device — so on a phone this was a faint
          disabled word with nothing to read. */}
      {row.filled > 0 && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <span className="font-semibold">Can&apos;t be deleted</span> —{" "}
          {row.filled} {row.filled === 1 ? "person has" : "people have"} signed up.
          Turn off <span className="font-medium">Open to signups</span> to close it
          to new volunteers and keep the roster.
        </p>
      )}

      {/* Sticky, like the services editor: Save stays reachable without
          scrolling back up a long card, and unsaved work announces itself
          instead of vanishing when the card collapses. */}
      <div className="sticky bottom-0 -mx-3 flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          disabled={pending || row.filled > 0}
          onClick={() => run(() => deleteVolunteerRole(eventId, row.id))}
          className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm text-red-600 disabled:opacity-40"
        >
          Delete
        </button>
        <span className="flex-1 text-xs text-amber-700">
          {dirty ? "Unsaved changes" : ""}
        </span>
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => run(() => saveVolunteerRole(eventId, row.id, f))}
          className="min-h-tap rounded-lg bg-brand px-5 font-semibold text-brand-fg disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
