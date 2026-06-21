"use client";

import { useState, useTransition } from "react";
import { createService, saveServiceRow } from "./actions";

export type ServiceRow = {
  id: string;
  name: string;
  priceDollars: number;
  colorHex: string;
  hasLab: boolean;
  fulfillable: boolean;
  active: boolean;
  capacity: number;
  sold: number;
};

const inputCls =
  "min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function ServicesManager({
  eventId,
  services,
}: {
  eventId: string;
  services: ServiceRow[];
}) {
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
        {services.map((s) => (
          <ServiceCard key={s.id} eventId={eventId} row={s} pending={pending} run={run} />
        ))}
      </ul>

      <NewService eventId={eventId} pending={pending} run={run} />
    </div>
  );
}

function ServiceCard({
  eventId,
  row,
  pending,
  run,
}: {
  eventId: string;
  row: ServiceRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState(row.name);
  const [price, setPrice] = useState(String(row.priceDollars));
  const [color, setColor] = useState(row.colorHex);
  const [hasLab, setHasLab] = useState(row.hasLab);
  const [fulfillable, setFulfillable] = useState(row.fulfillable);
  const [active, setActive] = useState(row.active);
  const [capacity, setCapacity] = useState(String(row.capacity));

  return (
    <li className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <input
          type="color"
          className="min-h-tap w-12 rounded border border-gray-300"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          className={`flex-1 ${inputCls}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
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
          Capacity
          <input
            type="number"
            min="0"
            className={`w-full ${inputCls}`}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-gray-400">{row.sold} sold this camp</p>

      <div className="flex flex-wrap gap-4">
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={hasLab}
            onChange={(e) => setHasLab(e.target.checked)}
          />
          Mails labs
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={fulfillable}
            onChange={(e) => setFulfillable(e.target.checked)}
          />
          Merch (hand over)
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() =>
            saveServiceRow(eventId, row.id, {
              name,
              priceDollars: Number(price) || 0,
              colorHex: color,
              hasLab,
              fulfillable,
              active,
              capacity: Number(capacity) || 0,
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

function NewService({
  eventId,
  pending,
  run,
}: {
  eventId: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [color, setColor] = useState("#2563b0");
  const [hasLab, setHasLab] = useState(false);
  const [fulfillable, setFulfillable] = useState(false);
  const [capacity, setCapacity] = useState("200");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
      >
        + Add service
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <input
          type="color"
          className="min-h-tap w-12 rounded border border-gray-300"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          className={`flex-1 ${inputCls}`}
          placeholder="Service name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
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
          min="0"
          className={inputCls}
          placeholder="Capacity"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </div>
      <label className="flex min-h-tap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={hasLab}
          onChange={(e) => setHasLab(e.target.checked)}
        />
        Mails labs
      </label>
      <label className="flex min-h-tap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={fulfillable}
          onChange={(e) => setFulfillable(e.target.checked)}
        />
        Merch (hand over)
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await createService(eventId, {
                name,
                priceDollars: Number(price) || 0,
                colorHex: color,
                hasLab,
                fulfillable,
                capacity: Number(capacity) || 0,
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
