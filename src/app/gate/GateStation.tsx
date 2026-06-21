"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { QrScanner } from "@/app/checkin/QrScanner";
import type { GateView } from "@/server/gate";
import {
  resolveGate,
  admit,
  fulfill,
  comp,
  sellAndAdmit,
  sellMerch,
  confirmUnpaidAndAdmit,
} from "./actions";

type CatalogItem = { id: string; name: string; priceCents: number };
type MerchItem = CatalogItem & { colorHex: string };
type Catalog = { admission: CatalogItem[]; merch: MerchItem[] };

type Flash = { kind: "ok" | "warn" | "err"; text: string };

/**
 * Gate station (phone-first, continuous scan). The camera stays live; each scan
 * resolves a guest and lights up the relevant action blocks — admit / pay-now,
 * will-call pickup, buy-more — plus a member-comp and a walk-up path that don't
 * need a scan. Headcount is the cumulative number admitted.
 */
export function GateStation({
  eventId,
  eventName,
  initialHeadcount,
  catalog,
}: {
  eventId: string;
  eventName: string;
  initialHeadcount: number;
  catalog: Catalog;
}) {
  const [headcount, setHeadcount] = useState(initialHeadcount);
  const [view, setView] = useState<GateView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pending, startTransition] = useTransition();

  const [pickupSel, setPickupSel] = useState<Set<string>>(new Set());
  const [buySel, setBuySel] = useState<Set<string>>(new Set());
  const [compCount, setCompCount] = useState(1);
  const [walkUp, setWalkUp] = useState(false);

  function run(fn: () => Promise<void>) {
    startTransition(fn);
  }

  function clearGuest() {
    setView(null);
    setPickupSel(new Set());
    setBuySel(new Set());
  }

  function onScan(code: string) {
    run(async () => {
      const res = await resolveGate(code);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      if (!res.data) {
        clearGuest();
        return setFlash({ kind: "warn", text: `No match for ${code}` });
      }
      setFlash(null);
      setPickupSel(new Set());
      setBuySel(new Set());
      setView(res.data);
    });
  }

  async function refresh(campId: string | null) {
    if (!campId) return;
    const res = await resolveGate(campId);
    if (res.ok && res.data) setView(res.data);
  }

  function doAdmit() {
    if (!view) return;
    run(async () => {
      const res = await admit(view.attendeeId, eventId);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      setHeadcount(res.data);
      setFlash({ kind: "ok", text: `${view.name ?? "Guest"} admitted — give wristband` });
      clearGuest();
    });
  }

  function doPayUnpaid() {
    if (!view) return;
    run(async () => {
      const res = await confirmUnpaidAndAdmit(view.orderId, view.attendeeId, eventId);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      setHeadcount(res.data);
      setFlash({ kind: "ok", text: `${view.name ?? "Guest"} paid & admitted — give wristband` });
      clearGuest();
    });
  }

  function doPickup() {
    if (!view || pickupSel.size === 0) return;
    const campId = view.campId;
    run(async () => {
      const res = await fulfill([...pickupSel]);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      setFlash({ kind: "ok", text: "Handed over ✓" });
      setPickupSel(new Set());
      await refresh(campId);
    });
  }

  function doBuyMore() {
    if (!view || buySel.size === 0) return;
    const campId = view.campId;
    run(async () => {
      const res = await sellMerch(eventId, [...buySel], view.attendeeId);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      setFlash({ kind: "ok", text: "Sold & handed over ✓" });
      setBuySel(new Set());
      await refresh(campId);
    });
  }

  function doComp() {
    run(async () => {
      const res = await comp(eventId, compCount);
      if (!res.ok) return setFlash({ kind: "err", text: res.error });
      setHeadcount(res.data);
      setFlash({
        kind: "ok",
        text: `Comped ${compCount} — give wristband${compCount > 1 ? "s" : ""}`,
      });
      setCompCount(1);
    });
  }

  return (
    <div className="mt-4 space-y-5">
      {/* Headcount */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Admitted</p>
          <p className="text-3xl font-bold tabular-nums">{headcount}</p>
        </div>
        <p className="max-w-[55%] text-right text-xs text-gray-400">{eventName}</p>
      </div>

      {/* Continuous scanner */}
      <QrScanner onScan={onScan} continuous />

      {/* Manual entry — camera-free fallback (mirrors check-in). */}
      <ManualEntry disabled={pending} onSubmit={onScan} />

      {flash && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            flash.kind === "ok"
              ? "bg-green-50 text-green-800"
              : flash.kind === "warn"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      {/* Resolved guest */}
      {view && (
        <div className="space-y-4 rounded-xl border border-gray-300 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold">{view.name ?? "Guest"}</span>
            <span className="font-mono text-xs text-gray-500">{view.campId}</span>
          </div>

          {/* Admission */}
          {view.alreadyAdmitted ? (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              Already admitted ✓{" "}
              {view.admittedAt && (
                <span className="text-green-700">
                  ({new Date(view.admittedAt).toLocaleTimeString()})
                </span>
              )}{" "}
              — wristband issued.
            </div>
          ) : view.isPaid ? (
            <button
              type="button"
              disabled={pending}
              onClick={doAdmit}
              className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
            >
              Paid ✓ — Admit &amp; wristband
            </button>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Unpaid — owes {formatCents(view.amountOwedCents)}.
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={doPayUnpaid}
                className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
              >
                Take cash {formatCents(view.amountOwedCents)} &amp; admit
              </button>
            </div>
          )}

          {/* Pickup */}
          {view.pickupItems.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Pre-bought — hand over
              </p>
              <ul className="space-y-1.5">
                {view.pickupItems.map((it) => (
                  <li key={it.lineItemId}>
                    {it.fulfilledAt ? (
                      <span className="flex items-center gap-2 text-sm text-gray-500">
                        <span className="text-green-600">✓</span> {it.name} — handed over
                      </span>
                    ) : (
                      <label className="flex min-h-tap items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={pickupSel.has(it.lineItemId)}
                          onChange={(e) => {
                            const next = new Set(pickupSel);
                            if (e.target.checked) next.add(it.lineItemId);
                            else next.delete(it.lineItemId);
                            setPickupSel(next);
                          }}
                        />
                        {it.name}
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              {pickupSel.size > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={doPickup}
                  className="mt-2 min-h-tap w-full rounded-lg border border-brand font-semibold text-brand disabled:opacity-50"
                >
                  Hand over selected ({pickupSel.size})
                </button>
              )}
            </div>
          )}

          {/* Buy more */}
          {catalog.merch.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Buy more
              </p>
              <ItemPicker items={catalog.merch} selected={buySel} onToggle={setBuySel} />
              {buySel.size > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={doBuyMore}
                  className="mt-2 min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
                >
                  Take cash {formatCents(sum(catalog.merch, buySel))} &amp; hand over
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={clearGuest}
            className="min-h-tap w-full rounded-lg border border-gray-300 text-sm"
          >
            Done — next guest
          </button>
        </div>
      )}

      {/* Member comp */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Member comp
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Check the membership card. Covers up to 4.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Stepper value={compCount} onChange={setCompCount} min={1} max={4} />
          <button
            type="button"
            disabled={pending}
            onClick={doComp}
            className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
          >
            Comp {compCount} &amp; admit
          </button>
        </div>
      </div>

      {/* Walk-up (no ticket) */}
      {!walkUp ? (
        <button
          type="button"
          onClick={() => setWalkUp(true)}
          className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
        >
          No ticket — walk-up sale
        </button>
      ) : (
        <WalkUpForm
          catalog={catalog}
          pending={pending}
          onCancel={() => setWalkUp(false)}
          onSubmit={(serviceTypeIds, name) =>
            run(async () => {
              const res = await sellAndAdmit(eventId, serviceTypeIds, name);
              if (!res.ok) return setFlash({ kind: "err", text: res.error });
              setHeadcount(res.data);
              setFlash({
                kind: "ok",
                text: `${name || "Walk-up"} admitted — give wristband`,
              });
              setWalkUp(false);
            })
          }
        />
      )}
    </div>
  );
}

function ManualEntry({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = code.trim();
        if (v) {
          onSubmit(v);
          setCode("");
        }
      }}
      className="flex gap-2"
    >
      <input
        className="min-h-tap w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base uppercase"
        placeholder="Or enter ticket ID (e.g. GB-2026W-0001)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
      />
      <button
        type="submit"
        disabled={disabled}
        className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm font-medium disabled:opacity-50"
      >
        Look up
      </button>
    </form>
  );
}

function ItemPicker({
  items,
  selected,
  onToggle,
}: {
  items: (CatalogItem & { colorHex?: string })[];
  selected: Set<string>;
  onToggle: (next: Set<string>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = selected.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(it.id);
              else next.add(it.id);
              onToggle(next);
            }}
            className={`min-h-tap rounded-full border px-3 py-1.5 text-sm ${
              on
                ? "border-brand bg-brand text-brand-fg"
                : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            {it.colorHex && (
              <span
                className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: it.colorHex }}
              />
            )}
            {it.name} · {formatCents(it.priceCents)}
          </button>
        );
      })}
    </div>
  );
}

function WalkUpForm({
  catalog,
  pending,
  onCancel,
  onSubmit,
}: {
  catalog: Catalog;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (serviceTypeIds: string[], name: string) => void;
}) {
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const all = [...catalog.admission, ...catalog.merch];
  const total = sum(all, sel);

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Walk-up sale
      </p>
      <input
        className="min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {catalog.admission.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">Admission</p>
          <ItemPicker items={catalog.admission} selected={sel} onToggle={setSel} />
        </div>
      )}
      {catalog.merch.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">Merch</p>
          <ItemPicker items={catalog.merch} selected={sel} onToggle={setSel} />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || sel.size === 0}
          onClick={() => onSubmit([...sel], name)}
          className="min-h-tap flex-1 rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          Take cash {formatCents(total)} &amp; admit
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap rounded-lg border border-gray-300 px-4 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="h-11 w-11 rounded-lg border border-gray-300 text-lg font-bold"
      >
        −
      </button>
      <span className="w-6 text-center text-lg font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-11 w-11 rounded-lg border border-gray-300 text-lg font-bold"
      >
        +
      </button>
    </div>
  );
}

function sum(items: CatalogItem[], selected: Set<string>): number {
  return items.reduce((s, it) => (selected.has(it.id) ? s + it.priceCents : s), 0);
}
