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

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <ul className="space-y-3">
        {roles.map((r) => (
          <RoleCard key={r.id} eventId={eventId} row={r} pending={pending} run={run} />
        ))}
        {roles.length === 0 && (
          <li className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
            No roles yet. Add the first one below.
          </li>
        )}
      </ul>

      <div className="flex gap-2">
        <input
          className={`flex-1 ${inputCls}`}
          placeholder="New role name (e.g. Greeter)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await createVolunteerRole(eventId, newName);
              if (res.ok) setNewName("");
              return res;
            })
          }
          className="min-h-tap rounded-lg bg-brand px-4 font-semibold text-brand-fg disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RoleCard({
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
    <li className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <input
          className={inputCls}
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <span className="shrink-0 text-xs text-gray-500">
          {row.filled}
          {row.capacity > 0 ? `/${row.capacity}` : ""} filled
        </span>
      </div>

      <input
        className={inputCls}
        placeholder="Short description"
        value={f.description}
        onChange={(e) => set({ description: e.target.value })}
      />

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-gray-500">Min age</span>
          <select
            className={`${inputCls} mt-1`}
            value={f.minAge}
            onChange={(e) => set({ minAge: Number(e.target.value) })}
          >
            <option value={0}>Any age</option>
            <option value={16}>16+</option>
            <option value={18}>18+</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-500">Target count</span>
          <input
            type="number"
            min={0}
            className={`${inputCls} mt-1`}
            value={f.capacity}
            onChange={(e) => set({ capacity: Number(e.target.value) })}
          />
        </label>
      </div>

      <input
        className={inputCls}
        placeholder="Shift (e.g. 8:00–12:00)"
        value={f.shift}
        onChange={(e) => set({ shift: e.target.value })}
      />
      <textarea
        className={`${inputCls} min-h-[3rem]`}
        placeholder="Instructions (shown at confirmation + check-in)"
        value={f.instructions}
        onChange={(e) => set({ instructions: e.target.value })}
      />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
          Active
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

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={pending || row.filled > 0}
          onClick={() => run(() => deleteVolunteerRole(eventId, row.id))}
          className="min-h-tap text-sm text-red-600 disabled:opacity-30"
          title={row.filled > 0 ? "Has signups — set inactive instead" : "Delete"}
        >
          Delete
        </button>
        {dirty && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => saveVolunteerRole(eventId, row.id, f))}
            className="min-h-tap rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
    </li>
  );
}
