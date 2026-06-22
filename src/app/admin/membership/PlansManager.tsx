"use client";

import { useState, useTransition } from "react";
import { createPlan, savePlan } from "./actions";

export type PlanRow = {
  id: string;
  name: string;
  termYears: number;
  priceDollars: number;
  partySize: number;
  active: boolean;
};

const inputCls = "min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function PlansManager({ plans }: { plans: PlanRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        {plans.map((p) => (
          <PlanCard key={p.id} row={p} pending={pending} run={run} />
        ))}
      </ul>
      <NewPlan pending={pending} run={run} />
    </div>
  );
}

function PlanCard({
  row,
  pending,
  run,
}: {
  row: PlanRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState(row.name);
  const [termYears, setTermYears] = useState(String(row.termYears));
  const [price, setPrice] = useState(String(row.priceDollars));
  const [partySize, setPartySize] = useState(String(row.partySize));
  const [active, setActive] = useState(row.active);

  return (
    <li className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <input
        className={`w-full ${inputCls}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm text-gray-600">
          Term (yrs)
          <input
            type="number"
            min="1"
            className={`w-full ${inputCls}`}
            value={termYears}
            onChange={(e) => setTermYears(e.target.value)}
          />
        </label>
        <label className="text-sm text-gray-600">
          Price ($)
          <input
            type="number"
            min="0"
            step="0.01"
            className={`w-full ${inputCls}`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="text-sm text-gray-600">
          Family size
          <input
            type="number"
            min="1"
            className={`w-full ${inputCls}`}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
          />
        </label>
      </div>
      <label className="flex min-h-tap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() =>
            savePlan(row.id, {
              name,
              termYears: Number(termYears) || 1,
              priceDollars: Number(price) || 0,
              partySize: Number(partySize) || 1,
              active,
            }),
          )
        }
        className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
      >
        Save
      </button>
    </li>
  );
}

function NewPlan({
  pending,
  run,
}: {
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [termYears, setTermYears] = useState("1");
  const [price, setPrice] = useState("0");
  const [partySize, setPartySize] = useState("4");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        + Add plan
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <input
        className={`w-full ${inputCls}`}
        placeholder="Plan name (e.g. Family — 2 Year)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-3">
        <input
          type="number"
          min="1"
          className={inputCls}
          placeholder="Yrs"
          value={termYears}
          onChange={(e) => setTermYears(e.target.value)}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className={inputCls}
          placeholder="Price $"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          type="number"
          min="1"
          className={inputCls}
          placeholder="Family"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await createPlan({
                name,
                termYears: Number(termYears) || 1,
                priceDollars: Number(price) || 0,
                partySize: Number(partySize) || 1,
              });
              if (res.ok) {
                setOpen(false);
                setName("");
              }
              return res;
            })
          }
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
