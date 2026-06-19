"use client";

import { useState, useTransition } from "react";
import { createStation, updateStation, moveStation } from "./actions";

export type StationRow = {
  id: string;
  name: string;
  colorHex: string | null;
  active: boolean;
};

const inputCls =
  "min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function StationsManager({
  eventId,
  stations,
}: {
  eventId: string;
  stations: StationRow[];
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

      <ol className="space-y-3">
        {stations.map((s, i) => (
          <StationCard
            key={s.id}
            eventId={eventId}
            row={s}
            index={i}
            count={stations.length}
            pending={pending}
            run={run}
          />
        ))}
      </ol>

      <div className="flex gap-2">
        <input
          className={`flex-1 ${inputCls}`}
          placeholder="New station name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await createStation(eventId, newName);
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

function StationCard({
  eventId,
  row,
  index,
  count,
  pending,
  run,
}: {
  eventId: string;
  row: StationRow;
  index: number;
  count: number;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState(row.name);
  const [active, setActive] = useState(row.active);
  const dirty = name !== row.name || active !== row.active;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      <span
        className="inline-block h-4 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: row.colorHex ?? "#888" }}
      />
      <div className="flex flex-1 flex-col gap-2">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <label className="flex min-h-tap items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
          {dirty && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => updateStation(eventId, row.id, { name, active }))
              }
              className="min-h-tap rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg disabled:opacity-50"
            >
              Save
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={pending || index === 0}
          onClick={() => run(() => moveStation(eventId, row.id, "up"))}
          className="min-h-tap w-10 rounded border border-gray-300 disabled:opacity-30"
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || index === count - 1}
          onClick={() => run(() => moveStation(eventId, row.id, "down"))}
          className="min-h-tap w-10 rounded border border-gray-300 disabled:opacity-30"
          aria-label="Move down"
        >
          ↓
        </button>
      </div>
    </li>
  );
}
