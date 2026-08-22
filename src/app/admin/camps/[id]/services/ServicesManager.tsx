"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ServiceKind } from "@prisma/client";
import { addOffering, removeOffering, saveOffering } from "./actions";

/** A service THIS event offers. One row per ServiceCap — presence means offered. */
export type Offering = {
  serviceTypeId: string;
  /** Catalogue attributes. Read-only here; edited at /admin/services. */
  name: string;
  colorHex: string;
  kind: ServiceKind;
  admitsCount: number;
  hasLab: boolean;
  /** Per-event fields below — everything this screen may write. */
  priceDollars: number;
  onsitePriceDollars: number | null;
  earlyBirdPriceDollars: number | null;
  /** "YYYY-MM-DDTHH:mm" for the datetime-local input, or null. */
  earlyBirdUntil: string | null;
  /** Null = uncapped. Never 0 — the DB refuses it. */
  capacity: number | null;
  sold: number;
  minParticipants: number | null;
  maxParticipants: number | null;
  /** "m:ss", the format a choreographer is quoted. Null = unconstrained. */
  minDuration: string | null;
  maxDuration: string | null;
};

/** A catalogue service, for the Add picker. */
export type CatalogueEntry = {
  id: string;
  name: string;
  kind: ServiceKind;
  colorHex: string;
  priceDollars: number;
};

const KIND_LABEL: Record<ServiceKind, string> = {
  ADMISSION: "Admission",
  MERCH: "Merchandise",
  FEE: "Entry fee",
};

const KIND_STYLE: Record<ServiceKind, string> = {
  ADMISSION: "bg-blue-100 text-blue-700",
  MERCH: "bg-amber-100 text-amber-800",
  FEE: "bg-purple-100 text-purple-700",
};

const inputCls =
  "min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base";

function money(dollars: number): string {
  return `$${dollars.toFixed(2).replace(/\.00$/, "")}`;
}

export function ServicesManager({
  eventId,
  offerings,
  catalogue,
}: {
  eventId: string;
  offerings: Offering[];
  catalogue: CatalogueEntry[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One card open at a time. Twelve simultaneously-expanded cards is what made
  // this screen 9,000px tall on a phone; an accordion is the whole fix.
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  const offeredIds = new Set(offerings.map((o) => o.serviceTypeId));
  const available = catalogue.filter((c) => !offeredIds.has(c.id));

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {offerings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
          This event doesn&apos;t sell anything yet. Add the services it actually
          offers — nothing from the catalogue applies until you do.
        </p>
      ) : (
        <ul className="space-y-2">
          {offerings.map((o) => (
            <OfferingCard
              key={o.serviceTypeId}
              eventId={eventId}
              row={o}
              open={openId === o.serviceTypeId}
              onToggle={() =>
                setOpenId((prev) => (prev === o.serviceTypeId ? null : o.serviceTypeId))
              }
              pending={pending}
              run={run}
            />
          ))}
        </ul>
      )}

      {picking ? (
        <AddPicker
          eventId={eventId}
          available={available}
          catalogue={catalogue}
          pending={pending}
          onClose={() => setPicking(false)}
          run={run}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm font-medium text-brand"
        >
          + Add service
        </button>
      )}
    </div>
  );
}

/**
 * Collapsed by default: name, kind, price and capacity as plain text, which is
 * all a coordinator reads when scanning the list. Editing is a deliberate tap.
 */
function OfferingCard({
  eventId,
  row,
  open,
  onToggle,
  pending,
  run,
}: {
  eventId: string;
  row: Offering;
  open: boolean;
  onToggle: () => void;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const capacityLabel =
    row.capacity === null ? "Unlimited" : `${row.sold} / ${row.capacity} sold`;

  return (
    <li className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-tap w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: row.colorHex }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-gray-900">{row.name}</span>
          <span className="block truncate text-xs text-gray-500">
            {money(row.priceDollars)} · {capacityLabel}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[row.kind]}`}
        >
          {KIND_LABEL[row.kind]}
        </span>
        <span aria-hidden className="shrink-0 text-gray-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && <OfferingEditor eventId={eventId} row={row} pending={pending} run={run} />}
    </li>
  );
}

function OfferingEditor({
  eventId,
  row,
  pending,
  run,
}: {
  eventId: string;
  row: Offering;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [price, setPrice] = useState(String(row.priceDollars));
  const [capped, setCapped] = useState(row.capacity !== null);
  // Kept even while "Unlimited" is selected so toggling back doesn't lose the
  // number the coordinator already typed.
  const [capacity, setCapacity] = useState(
    row.capacity === null ? "" : String(row.capacity),
  );
  const [onsitePrice, setOnsitePrice] = useState(
    row.onsitePriceDollars === null ? "" : String(row.onsitePriceDollars),
  );
  const [earlyBirdPrice, setEarlyBirdPrice] = useState(
    row.earlyBirdPriceDollars === null ? "" : String(row.earlyBirdPriceDollars),
  );
  const [earlyBirdUntil, setEarlyBirdUntil] = useState(row.earlyBirdUntil ?? "");
  const [minParticipants, setMinParticipants] = useState(
    row.minParticipants === null ? "" : String(row.minParticipants),
  );
  const [maxParticipants, setMaxParticipants] = useState(
    row.maxParticipants === null ? "" : String(row.maxParticipants),
  );
  const [minDuration, setMinDuration] = useState(row.minDuration ?? "");
  const [maxDuration, setMaxDuration] = useState(row.maxDuration ?? "");

  const capacityValue = capped ? capacity.trim() : "";
  const dirty =
    price !== String(row.priceDollars) ||
    capped !== (row.capacity !== null) ||
    capacityValue !== (row.capacity === null ? "" : String(row.capacity)) ||
    onsitePrice !== (row.onsitePriceDollars === null ? "" : String(row.onsitePriceDollars)) ||
    earlyBirdPrice !==
      (row.earlyBirdPriceDollars === null ? "" : String(row.earlyBirdPriceDollars)) ||
    earlyBirdUntil !== (row.earlyBirdUntil ?? "") ||
    minParticipants !== (row.minParticipants === null ? "" : String(row.minParticipants)) ||
    maxParticipants !== (row.maxParticipants === null ? "" : String(row.maxParticipants)) ||
    minDuration !== (row.minDuration ?? "") ||
    maxDuration !== (row.maxDuration ?? "");

  const blankToNull = (raw: string): number | null =>
    raw.trim() === "" ? null : Number(raw);

  return (
    <div className="space-y-4 border-t border-gray-100 px-3 pb-3 pt-4">
      {/* Name, colour and kind are org-wide. Shown, not edited: renaming a
          service here would silently rename it at every other event too. */}
      <div>
        <p className="text-xs text-gray-500">
          {KIND_LABEL[row.kind]}
          {row.kind === "ADMISSION" && row.admitsCount > 1
            ? ` · admits ${row.admitsCount} per unit`
            : ""}
          {row.hasLab ? " · mails labs" : ""}
        </p>
        <Link
          href="/admin/services"
          className="inline-flex min-h-tap items-center text-xs text-brand underline"
        >
          Edit name, colour or kind in the catalogue →
        </Link>
      </div>

      <label className="block text-sm text-gray-600">
        Price at this event ($)
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className={inputCls}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>

      <fieldset>
        <legend className="text-sm text-gray-600">Capacity</legend>
        {/* Explicit "Unlimited" rather than an empty or zero box: a blank
            capacity read as 0, and 0 charges the buyer then fails to confirm. */}
        <div className="mt-1 flex gap-2">
          <CapacityChoice
            label="Unlimited"
            selected={!capped}
            onSelect={() => setCapped(false)}
          />
          <CapacityChoice
            label="Limit to…"
            selected={capped}
            onSelect={() => setCapped(true)}
          />
        </div>
        {capped && (
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            aria-label="Capacity limit"
            placeholder="e.g. 200"
            className={`mt-2 ${inputCls}`}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        )}
        <p className="mt-1 text-xs text-gray-400">
          {row.sold} sold so far at this event.
        </p>
      </fieldset>

      <label className="block text-sm text-gray-600">
        Door price ($)
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="same as online"
          className={inputCls}
          value={onsitePrice}
          onChange={(e) => setOnsitePrice(e.target.value)}
        />
      </label>

      <label className="block text-sm text-gray-600">
        Early-bird price ($)
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="no early bird"
          className={inputCls}
          value={earlyBirdPrice}
          onChange={(e) => setEarlyBirdPrice(e.target.value)}
        />
      </label>

      <label className="block text-sm text-gray-600">
        Early bird ends
        <input
          type="datetime-local"
          className={inputCls}
          value={earlyBirdUntil}
          onChange={(e) => setEarlyBirdUntil(e.target.value)}
        />
      </label>

      {/* Only a fee buys a slot in a competition, so the rules that govern that
          slot are meaningless on an admission or on merchandise. */}
      {row.kind === "FEE" && (
        <fieldset className="space-y-3 rounded-lg bg-gray-50 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">
            Competition rules
          </legend>
          <p className="text-xs text-gray-500">
            Enforced when a group submits. Leave blank for no limit.
          </p>
          <label className="block text-sm text-gray-600">
            Fewest participants
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="no minimum"
              className={inputCls}
              value={minParticipants}
              onChange={(e) => setMinParticipants(e.target.value)}
            />
          </label>
          <label className="block text-sm text-gray-600">
            Most participants
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="no maximum"
              className={inputCls}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
            />
          </label>
          <label className="block text-sm text-gray-600">
            Shortest performance (m:ss)
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 5:00"
              className={inputCls}
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value)}
            />
          </label>
          <label className="block text-sm text-gray-600">
            Longest performance (m:ss)
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 6:00"
              className={inputCls}
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
            />
          </label>
        </fieldset>
      )}

      {/* Sticky so Save stays reachable without scrolling back up a long card,
          and so unsaved work announces itself instead of being lost on collapse. */}
      <div className="sticky bottom-0 -mx-3 flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          disabled={pending || row.sold > 0}
          onClick={() => run(() => removeOffering(eventId, row.serviceTypeId))}
          className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm text-gray-700 disabled:opacity-40"
          title={row.sold > 0 ? "Already sold at this event" : undefined}
        >
          Remove
        </button>
        <span className="flex-1 text-xs text-amber-700">
          {dirty ? "Unsaved changes" : ""}
        </span>
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            run(() =>
              saveOffering(eventId, row.serviceTypeId, {
                priceDollars: Number(price) || 0,
                onsitePriceDollars: blankToNull(onsitePrice),
                earlyBirdPriceDollars: blankToNull(earlyBirdPrice),
                earlyBirdUntil: earlyBirdUntil.trim() === "" ? null : earlyBirdUntil,
                // "Unlimited" submits null. 0 is never sent — the DB rejects it.
                capacity: capped ? blankToNull(capacity) : null,
                minParticipants: blankToNull(minParticipants),
                maxParticipants: blankToNull(maxParticipants),
                minDuration: minDuration.trim() === "" ? null : minDuration,
                maxDuration: maxDuration.trim() === "" ? null : maxDuration,
              }),
            )
          }
          className="min-h-tap rounded-lg bg-brand px-5 font-semibold text-brand-fg disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CapacityChoice({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`min-h-tap flex-1 rounded-lg border px-3 text-sm font-medium ${
        selected
          ? "border-brand bg-brand text-brand-fg"
          : "border-gray-300 bg-white text-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Ignore case, spacing and punctuation, then count single-character edits.
 * The catalogue holds "Dandia Entry" ($25) and "Dandiya Entry" ($12) — one
 * letter apart, ten dollars apart — and a picker that lists them as two
 * unremarkable rows is how the wrong one gets attached to an event.
 */
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

function AddPicker({
  eventId,
  available,
  catalogue,
  pending,
  onClose,
  run,
}: {
  eventId: string;
  available: CatalogueEntry[];
  /** The whole catalogue, so a near-duplicate is flagged even when its twin is
      already attached to this event and therefore absent from `available`. */
  catalogue: CatalogueEntry[];
  pending: boolean;
  onClose: () => void;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? available.filter((c) => c.name.toLowerCase().includes(needle))
    : available;

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Add from the catalogue</h3>
        <button
          type="button"
          onClick={onClose}
          className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm"
        >
          Cancel
        </button>
      </div>

      {available.length > 4 && (
        <input
          type="search"
          placeholder="Search services"
          aria-label="Search the catalogue"
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {available.length === 0 ? (
        <p className="text-sm text-gray-600">
          Every active catalogue service is already offered here.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => {
            const twin = catalogue.find(
              (other) => other.id !== c.id && editDistance(other.name, c.name) <= 2,
            );
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    run(async () => {
                      const res = await addOffering(eventId, c.id);
                      if (res.ok) onClose();
                      return res;
                    });
                  }}
                  className="flex min-h-tap w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: c.colorHex }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-900">
                      {c.name}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {KIND_LABEL[c.kind]} · {money(c.priceDollars)}
                    </span>
                    {twin && (
                      <span className="mt-1 block rounded bg-amber-50 px-1.5 py-1 text-xs text-amber-800">
                        Nearly the same name as &ldquo;{twin.name}&rdquo; (
                        {money(twin.priceDollars)}) — check this is the one you mean.
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/admin/services"
        className="flex min-h-tap items-center text-sm text-brand underline"
      >
        Not listed? Add it to the catalogue →
      </Link>
    </div>
  );
}
