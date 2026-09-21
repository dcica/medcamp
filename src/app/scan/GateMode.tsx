"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { formatVenueTime } from "@/lib/eventTime";
import { expandTicketCode } from "@/lib/ticketCode";
import { QrScanner } from "@/app/_components/QrScanner";
import { ScanVerdictBanner } from "@/app/_components/ScanVerdictBanner";
import { verdictFor, signalForError, type ScanVerdict } from "@/lib/scanVerdict";
import { playTone } from "@/lib/scanTones";
import {
  acceptsDecode,
  shouldNudge,
  nextPhase,
  INITIAL_PHASE,
  type StationPhase,
} from "@/lib/scanLatch";
import type { GateView } from "@/server/gate";
import {
  resolveGate,
  admit,
  fulfill,
  comp,
  sellAndAdmit,
  sellMerch,
  confirmUnpaidAndAdmit,
} from "@/app/gate/actions";

type CatalogItem = { id: string; name: string; priceCents: number };
type MerchItem = CatalogItem & { colorHex: string };
// Must name every bucket getGateCatalog sends — structural typing let `fees`
// go missing here before and the compiler never caught it (see task A3).
type Catalog = { admission: CatalogItem[]; merch: MerchItem[]; fees: CatalogItem[] };

// `Flash` is gone. It was a 32px tinted strip that sat BELOW the camera, was
// set to null on success (so a successful scan said nothing at all), and used
// the SAME green for "just admitted" and "already admitted". The three
// meanings are now one ScanVerdict; see src/lib/scanVerdict.ts.

/**
 * Gate station (phone-first, continuous scan). The camera stays live; each scan
 * resolves a guest and lights up the relevant action blocks — admit / pay-now,
 * will-call pickup, buy-more — plus a member-comp and a walk-up path that don't
 * need a scan. Headcount is the cumulative number admitted.
 */
export function GateMode({
  eventId,
  eventName,
  eventCode,
  initialHeadcount,
  catalog,
}: {
  eventId: string;
  eventName: string;
  eventCode: string;
  initialHeadcount: number;
  catalog: Catalog;
}) {
  const [headcount, setHeadcount] = useState(initialHeadcount);
  const [view, setView] = useState<GateView | null>(null);
  // The standing verdict, if any. Only a deliberate tap moves this.
  const [phase, setPhase] = useState<StationPhase>(INITIAL_PHASE);
  const [nudge, setNudge] = useState(false);
  const [pending, startTransition] = useTransition();

  const [pickupSel, setPickupSel] = useState<Set<string>>(new Set());
  const [buySel, setBuySel] = useState<Set<string>>(new Set());
  const [compCount, setCompCount] = useState(1);
  const [walkUp, setWalkUp] = useState(false);

  function run(fn: () => Promise<void>) {
    startTransition(fn);
  }

  /**
   * Land a verdict and sound it. ONE place, so no path can show a banner
   * without the matching tone, or play a tone with nothing on screen.
   */
  function settle(verdict: ScanVerdict, event: "resolved" | "acted" = "acted") {
    setPhase((prev) => nextPhase(prev, { type: event, verdict }));
    playTone(verdict.tone);
  }

  /**
   * A completed hand-over. Tone `go` because the action succeeded, but it
   * deliberately does NOT reuse the ADMITTED verdict: nobody was admitted,
   * and "give wristband" under a merch pickup is how someone walks in free.
   */
  function handedOver(headline: string): ScanVerdict {
    return {
      outcome: "ADMITTED",
      tone: "go",
      glyph: "✓",
      headline,
      detail: view?.name ?? null,
      instruction: "Goods given to the guest",
    };
  }

  /** "Next guest" - the only exit from a standing verdict. */
  function release() {
    setPhase(INITIAL_PHASE);
    setNudge(false);
    clearGuest();
  }

  function clearGuest() {
    setView(null);
    setPickupSel(new Set());
    setBuySel(new Set());
  }

  function onScan(code: string) {
    // THE LATCH. A standing verdict is not replaced by the next badge that
    // drifts into frame - see src/lib/scanLatch.ts. The drop is announced,
    // and deliberately makes no sound: silence means "ignored on purpose".
    if (!acceptsDecode(phase)) {
      if (shouldNudge(phase, { type: "decoded" })) setNudge(true);
      return;
    }
    setNudge(false);
    setPhase((prev) => nextPhase(prev, { type: "decoded" }));
    run(async () => {
      const res = await resolveGate(code);
      if (!res.ok) {
        clearGuest();
        return settle(verdictFor(signalForError(res.error)), "resolved");
      }
      if (!res.data) {
        clearGuest();
        return settle(verdictFor({ kind: "noMatch", code }), "resolved");
      }
      const g = res.data;
      setPickupSel(new Set());
      setBuySel(new Set());
      setView(g);

      // A resolve is already a verdict for every state the volunteer cannot
      // simply act on. Only "paid, here, not yet admitted" leaves the station
      // quiet and waiting for the Admit tap, because nothing has happened yet.
      if (g.eventId !== eventId) {
        return settle(
          verdictFor({ kind: "wrongEvent", eventName: g.eventName }),
          "resolved",
        );
      }
      if (g.alreadyAdmitted) {
        return settle(
          verdictFor({
            kind: "already",
            flow: "gate",
            at: g.admittedAt ? formatVenueTime(new Date(g.admittedAt)) : null,
          }),
          "resolved",
        );
      }
      if (!g.isPaid) {
        return settle(
          verdictFor({ kind: "unpaid", owed: formatCents(g.amountOwedCents) }),
          "resolved",
        );
      }
      setPhase(INITIAL_PHASE);
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
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      setHeadcount(res.data.headcount);
      // The discriminant, never an assumption. A guest admitted at another
      // door between this scan and this tap now reads amber, not green.
      settle(
        res.data.result.state === "admitted"
          ? verdictFor({ kind: "admitted", name: view.name })
          : verdictFor({
              kind: "already",
              flow: "gate",
              at: formatVenueTime(res.data.result.at),
            }),
      );
    });
  }

  function doPayUnpaid() {
    if (!view) return;
    run(async () => {
      const res = await confirmUnpaidAndAdmit(view.orderId, view.attendeeId, eventId);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      setHeadcount(res.data.headcount);
      settle(
        res.data.result.state === "admitted"
          ? verdictFor({ kind: "admitted", name: view.name })
          : verdictFor({
              kind: "already",
              flow: "gate",
              at: formatVenueTime(res.data.result.at),
            }),
      );
    });
  }

  function doPickup() {
    if (!view || pickupSel.size === 0) return;
    const campId = view.campId;
    run(async () => {
      const res = await fulfill([...pickupSel]);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      settle(handedOver("Handed over"));
      setPickupSel(new Set());
      await refresh(campId);
    });
  }

  function doBuyMore() {
    if (!view || buySel.size === 0) return;
    const campId = view.campId;
    run(async () => {
      const res = await sellMerch(eventId, [...buySel], view.attendeeId);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      settle(handedOver("Sold and handed over"));
      setBuySel(new Set());
      await refresh(campId);
    });
  }

  function doComp() {
    run(async () => {
      const res = await comp(eventId, compCount);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      setHeadcount(res.data);
      settle({
        ...verdictFor({ kind: "admitted" }),
        headline: "Comped",
        detail: `${compCount} guest${compCount > 1 ? "s" : ""}`,
        instruction: `Give ${compCount} wristband${compCount > 1 ? "s" : ""}`,
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

      {/* ABOVE the camera, on purpose. The strip this replaces sat below
          both the scanner and the manual box, so a tall guest card pushed
          the one thing the volunteer needed off the bottom of the screen. */}
      {phase.phase === "held" && (
        <ScanVerdictBanner
          verdict={phase.verdict}
          onRelease={release}
          nudge={nudge}
        />
      )}

      {phase.phase === "reading" && (
        // Grey and SILENT. The volunteer needs to know the tap registered,
        // not that it succeeded - a tone here would pre-announce a verdict
        // the server has not given yet, which is the old beep all over again.
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
          Reading…
        </p>
      )}

      {/* Continuous scanner */}
      <QrScanner onScan={onScan} continuous />

      {/* Manual entry — camera-free fallback (mirrors check-in). */}
      <ManualEntry eventCode={eventCode} disabled={pending} onSubmit={onScan} />

      {/* Resolved guest */}
      {view && (
        <div className="space-y-4 rounded-xl border border-gray-300 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold">{view.name ?? "Guest"}</span>
            <span className="font-mono text-xs text-gray-500">{view.campId}</span>
          </div>

          {/* Admission */}
          {view.alreadyAdmitted ? (
            // NOT GREEN, and no longer shouting. This used to be
            // This was a green tint - the SAME one the fresh-admit flash used,
            // which is half of why green meant four different things. The amber
            // banner above now carries the verdict; this is just the record,
            // in venue time because the volunteer will compare it against the
            // clock on the wall.
            <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
              Wristband issued
              {view.admittedAt
                ? ` at ${formatVenueTime(new Date(view.admittedAt))}`
                : ""}
              .
            </p>
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
            // No tint here: the banner above already says UNPAID, the amount
            // and what to do about it, at full size. Saying it twice in two
            // different wordings is how the two drift apart.
            <div className="space-y-2">
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
              if (!res.ok) return settle(verdictFor(signalForError(res.error)));
              setHeadcount(res.data);
              settle(verdictFor({ kind: "admitted", name: name || "Walk-up" }));
              setWalkUp(false);
            })
          }
        />
      )}
    </div>
  );
}

/**
 * Fallback entry for when a scan won't take — a scuffed badge, a dead camera,
 * a phone screen someone can't get to brighten.
 *
 * The event prefix is shown as fixed text rather than typed. One door is
 * staffed for one event, the page already knows which, and re-typing
 * `DANDIYA-2026-` for every manual lookup is 13 characters of transcription
 * risk per ticket with a queue waiting. What's left is the random token, which
 * is the only part that actually varies.
 *
 * A complete id pasted or scanned into the box is still honoured as-is. Tokens
 * never contain a hyphen, so its presence is an unambiguous signal that the
 * operator has a whole id rather than a token — and that case genuinely
 * happens: someone arrives at the Dandiya door holding a Garba ticket. Blindly
 * prefixing would turn that into a "not found", when what staff need to see is
 * the ticket resolving against the wrong event so they can say so.
 *
 * The rule itself is `expandTicketCode` in `@/lib/ticketCode` — it outlives any
 * particular arrangement of this form and is pinned by scripts/verify-gate.ts.
 */
function ManualEntry({
  eventCode,
  disabled,
  onSubmit,
}: {
  eventCode: string;
  disabled: boolean;
  onSubmit: (code: string) => void;
}) {
  const [token, setToken] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = expandTicketCode(eventCode, token);
        if (!code) return;
        onSubmit(code);
        setToken("");
      }}
      className="flex gap-2"
    >
      {/* Prefix and field share one bordered box so they read as a single
          control. The border lives here, not on the input. */}
      <div className="flex min-h-tap w-full flex-1 items-center overflow-hidden rounded-lg border border-gray-300 bg-white px-3">
        <span className="shrink-0 select-none whitespace-nowrap text-base text-gray-500">
          {eventCode}-
        </span>
        <input
          className="w-full min-w-0 bg-transparent py-2 text-base uppercase outline-none"
          placeholder="K7M2XQ9T"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Ticket ID, after the ${eventCode}- prefix`}
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="min-h-tap shrink-0 rounded-lg border border-gray-300 px-4 text-sm font-medium disabled:opacity-50"
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
  const all = [...catalog.admission, ...catalog.merch, ...catalog.fees];
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
      {/* Fees (e.g. dance-competition entry): neither admission nor merch — buying
          one mints no ticket and hands over nothing, so it gets its own visually
          loud block. A volunteer who mistakes this for a ticket lets a group onto
          the floor without paying for it. Colors are the handoff's exact fee
          treatment, not the shared brand palette. */}
      {catalog.fees.length > 0 && (
        <div
          className="rounded-lg border p-3"
          style={{ backgroundColor: "#fff7e6", borderColor: "#a86800", borderWidth: 3 }}
        >
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#a86800" }}
          >
            Fees
          </p>
          <ItemPicker items={catalog.fees} selected={sel} onToggle={setSel} />
          <p className="mt-2 text-xs font-semibold" style={{ color: "#a86800" }}>
            NOT A TICKET · NO FLOOR ACCESS
          </p>
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
