"use client";

import { useState, useTransition } from "react";
import type { ServiceKind } from "@prisma/client";
import { createCatalogueService, updateCatalogueService } from "./actions";

export type CatalogueRow = {
  id: string;
  name: string;
  colorHex: string;
  kind: ServiceKind;
  admitsCount: number;
  hasLab: boolean;
  active: boolean;
  /** How many events currently offer it — the blast radius of an edit here. */
  eventCount: number;
};

const KINDS: { value: ServiceKind; label: string; hint: string }[] = [
  {
    value: "ADMISSION",
    label: "Admission",
    hint: "Issues a scannable ticket and counts toward the door headcount.",
  },
  {
    value: "MERCH",
    label: "Merchandise",
    hint: "A physical good handed over at the gate — dandiya sticks, a T-shirt.",
  },
  {
    value: "FEE",
    label: "Entry fee",
    hint: "Buys a slot and admits nobody — a competition entry.",
  },
];

const KIND_LABEL: Record<ServiceKind, string> = {
  ADMISSION: "Admission",
  MERCH: "Merchandise",
  FEE: "Entry fee",
};

const inputCls =
  "min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base";

export function CatalogueManager({ services }: { services: CatalogueRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {services.map((s) => (
          <li key={s.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              aria-expanded={openId === s.id}
              onClick={() => setOpenId((prev) => (prev === s.id ? null : s.id))}
              className="flex min-h-tap w-full items-center gap-3 px-3 py-2 text-left"
            >
              <span
                aria-hidden
                className="h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: s.colorHex }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-gray-900">
                  {s.name}
                  {!s.active && (
                    <span className="ml-2 text-xs font-normal text-gray-400">inactive</span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {KIND_LABEL[s.kind]}
                  {s.kind === "ADMISSION" && s.admitsCount > 1
                    ? ` ×${s.admitsCount}`
                    : ""}
                  {s.hasLab ? " · mails labs" : ""} ·{" "}
                  {s.eventCount === 0
                    ? "not offered anywhere"
                    : `offered at ${s.eventCount} event${s.eventCount === 1 ? "" : "s"}`}
                </span>
              </span>
              <span aria-hidden className="shrink-0 text-gray-400">
                {openId === s.id ? "▴" : "▾"}
              </span>
            </button>

            {openId === s.id && (
              <ServiceForm
                key={s.id}
                initial={s}
                pending={pending}
                submitLabel="Save"
                onSubmit={(values) =>
                  run(() => updateCatalogueService(s.id, { ...values, active: values.active }))
                }
              />
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <p className="px-3 pt-3 text-sm font-semibold">New catalogue service</p>
          <ServiceForm
            pending={pending}
            submitLabel="Add to catalogue"
            existingNames={services.map((s) => s.name)}
            onCancel={() => setAdding(false)}
            onSubmit={(values) =>
              run(async () => {
                const res = await createCatalogueService(values);
                if (res.ok) setAdding(false);
                return res;
              })
            }
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
        >
          + New service
        </button>
      )}
    </div>
  );
}

type FormValues = {
  name: string;
  colorHex: string;
  kind: ServiceKind;
  admitsCount: number;
  hasLab: boolean;
  active: boolean;
};

/** See ServicesManager's copy of this — same reason, different screen. */
function editDistance(a: string, b: string): number {
  const s = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const curr = [i];
    for (let j = 1; j <= t.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[t.length];
}

function ServiceForm({
  initial,
  pending,
  submitLabel,
  existingNames,
  onCancel,
  onSubmit,
}: {
  initial?: CatalogueRow;
  pending: boolean;
  submitLabel: string;
  /** Given on the create form only, to catch a near-duplicate before it exists. */
  existingNames?: string[];
  onCancel?: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [colorHex, setColorHex] = useState(initial?.colorHex ?? "#2563b0");
  const [kind, setKind] = useState<ServiceKind>(initial?.kind ?? "ADMISSION");
  const [admitsCount, setAdmitsCount] = useState(String(initial?.admitsCount ?? 1));
  const [hasLab, setHasLab] = useState(initial?.hasLab ?? false);
  const [active, setActive] = useState(initial?.active ?? true);

  const trimmed = name.trim();
  const twin =
    trimmed.length >= 4
      ? existingNames?.find((other) => editDistance(other, trimmed) <= 2)
      : undefined;

  return (
    <div className="space-y-4 border-t border-gray-100 px-3 pb-3 pt-4">
      {initial && initial.eventCount > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Changes here apply to all {initial.eventCount} event
          {initial.eventCount === 1 ? "" : "s"} that offer this service.
        </p>
      )}

      {/* Name first, colour second: the name is what identifies the service, and
          leading with a colour field made the identity look secondary. */}
      <label className="block text-sm text-gray-600">
        Name
        <input
          className={inputCls}
          placeholder="e.g. Dandiya Entry"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {twin && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          &ldquo;{twin}&rdquo; already exists and is nearly the same name. Two
          near-identical entries get picked at random later — rename one, or edit
          the existing service instead.
        </p>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600" htmlFor="service-color">
          Badge colour
        </label>
        <input
          id="service-color"
          type="color"
          className="min-h-tap w-16 rounded-lg border border-gray-300"
          value={colorHex}
          onChange={(e) => setColorHex(e.target.value)}
        />
      </div>

      {/* One choice, not three independent flags. The old checkbox trio let a
          service be an admission AND merchandise at once, which nothing
          downstream could act on. */}
      <fieldset>
        <legend className="text-sm text-gray-600">Kind</legend>
        <div className="mt-1 space-y-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`flex min-h-tap w-full flex-col justify-center rounded-lg border px-3 py-2 text-left ${
                kind === k.value
                  ? "border-brand bg-brand/5"
                  : "border-gray-300 bg-white"
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  kind === k.value ? "text-brand" : "text-gray-700"
                }`}
              >
                {k.label}
              </span>
              <span className="text-xs text-gray-500">{k.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {kind === "ADMISSION" && (
        <label className="block text-sm text-gray-600">
          People admitted per unit
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            className={inputCls}
            value={admitsCount}
            onChange={(e) => setAdmitsCount(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-400">
            Above 1 for a bundle — a &ldquo;family of 4&rdquo; is 4.
          </span>
        </label>
      )}

      <label className="flex min-h-tap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={hasLab}
          onChange={(e) => setHasLab(e.target.checked)}
        />
        Mails a lab result back
      </label>

      {initial && (
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
          <span className="text-xs font-normal text-gray-400">
            (inactive hides it everywhere without losing history)
          </span>
        </label>
      )}

      <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-gray-200 bg-white px-3 py-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={pending || trimmed === ""}
          onClick={() =>
            onSubmit({
              name,
              colorHex,
              kind,
              admitsCount: Number(admitsCount) || 1,
              hasLab,
              active,
            })
          }
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
