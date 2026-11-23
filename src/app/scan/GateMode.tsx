"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { formatVenueTime } from "@/lib/eventTime";
import { expandTicketCode, MIN_TOKEN_PREFIX } from "@/lib/ticketCode";
import { GATE_MAX_QTY_PER_LINE, type GateSaleItem } from "@/lib/ticketMinting";
import Link from "next/link";

import { QrScanner } from "@/app/_components/QrScanner";
import { PENDING_WORD, TONE_BAND, TONE_WORD } from "@/lib/scanToneStyles";
import {
  verdictFor,
  signalForError,
  isVoidOrder,
  type ScanVerdict,
  type ScanTone,
} from "@/lib/scanVerdict";
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
  startCardSale,
  pollCardSale,
  sellMerch,
  confirmUnpaidAndAdmit,
  searchGuests,
} from "@/app/gate/actions";

type CatalogItem = { id: string; name: string; priceCents: number };

/** id -> quantity. A Set could not hold a duplicate, which is exactly why
    the gate could never sell two of anything. */
type Basket = Map<string, number>;

function basketItems(b: Basket): GateSaleItem[] {
  return [...b.entries()].map(([serviceTypeId, quantity]) => ({ serviceTypeId, quantity }));
}

function basketTotal(items: CatalogItem[], b: Basket): number {
  return items.reduce((s, it) => s + it.priceCents * (b.get(it.id) ?? 0), 0);
}

/**
 * How many PEOPLE this basket admits.
 *
 * NOT the number of things in it. Three admissions plus two dandiya sticks
 * is five items and THREE people, and the button used to say "admit 5" while
 * the server correctly admitted 3 — a number on a button that did not match
 * what happened, which is the exact defect class this screen exists to fix.
 *
 * Mirrors admissionUnits() in src/lib/ticketMinting.ts, which is what the
 * server actually mints from; admitsCount is why a "family of 4" chip counts
 * four and not one.
 */
function admitsCountFor(
  admission: (CatalogItem & { admitsCount?: number })[],
  b: Basket,
): number {
  return admission.reduce(
    (s, it) => s + (b.get(it.id) ?? 0) * Math.max(1, it.admitsCount ?? 1),
    0,
  );
}
type MerchItem = CatalogItem & { colorHex: string };
// Must name every bucket getGateCatalog sends — structural typing let `fees`
// go missing here before and the compiler never caught it (see task A3).
type AdmissionItem = CatalogItem & { admitsCount: number };
type Catalog = { admission: AdmissionItem[]; merch: MerchItem[]; fees: CatalogItem[] };

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
  canTakeCash,
}: {
  eventId: string;
  eventName: string;
  eventCode: string;
  initialHeadcount: number;
  catalog: Catalog;
  /**
   * Whether THIS volunteer may record cash. A capability on the membership,
   * not a role. The server is still the gate (requireTill); this only stops
   * the screen offering a control that would bounce them to /403 and lose
   * the guest they had resolved.
   */
  canTakeCash: boolean;
}) {
  /**
   * REMOVED FROM THE HEADER on 2026-10-03.
   *
   * It was seeded from getEventHeadcount — the whole event — and then only
   * ever incremented by THIS device, so it was a stale event total wearing
   * a live-looking number. Labelling it honestly ("not live") just drew
   * attention to a figure nobody should act on. It comes back when it polls.
   * The setters stay because the server returns the count anyway and the
   * value is still useful to a future live view.
   */
  const [view, setView] = useState<GateView | null>(null);
  // The standing verdict, if any. Only a deliberate tap moves this.
  const [phase, setPhase] = useState<StationPhase>(INITIAL_PHASE);
  const [nudge, setNudge] = useState(false);
  const [hits, setHits] = useState<GateView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();

  const [pickupSel, setPickupSel] = useState<Set<string>>(new Set());
  const [buySel, setBuySel] = useState<Basket>(new Map());
  const [compCount, setCompCount] = useState(1);
  const [walkUp, setWalkUp] = useState(false);
  // Which task, if any, currently owns the screen. Only one at a time, and
  // each one collapses the camera rather than unmounting it.
  const [searchOpen, setSearchOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  // What the CAMERA is doing, reported by the scanner. Distinct from the
  // latch phase: the latch can be idle while the camera has never started.
  const [camActive, setCamActive] = useState(false);

  /**
   * A card sale waiting on the guest's own phone.
   *
   * The volunteer never handles the card: the gate shows a QR, the guest
   * scans it, pays through Stripe Checkout on their phone, and the WEBHOOK
   * confirms. This screen only watches. Nothing is admitted and no capacity
   * is claimed until the webhook has written CONFIRMED — the same rule the
   * online path lives by, and the reason an abandoned payment cannot let
   * anybody in.
   */
  const [cardSale, setCardSale] = useState<{
    orderId: string;
    qr: string;
    url: string;
    totalCents: number;
  } | null>(null);
  const [cardWaited, setCardWaited] = useState(0);
  /** Bumped to remount WalkUpForm with empty state, without hiding it. */
  const [walkUpNonce, setWalkUpNonce] = useState(0);

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

  /**
   * Turn an admit outcome into the verdict. ONE place, so a single guest and
   * a family of five cannot end up described by different rules.
   */
  function applyAdmit(out: {
    admitted: number;
    already: number;
    headcount: number;
    at: Date | null;
  }) {
    void (out.headcount);
    settle(
      verdictFor({
        kind: "party",
        admitted: out.admitted,
        already: out.already,
        at: out.at ? formatVenueTime(out.at) : null,
      }),
    );
  }

  function doAdmitMany(attendeeIds: string[]) {
    return (async () => {
      const res = await admit(attendeeIds, eventId);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      // MARK THEM IN, LOCALLY. `view` is a snapshot taken at resolve time and
      // nothing refetches it, so without this the pips still read "0 of 4 in"
      // under a banner saying "Admitted 4", and the dock still offers
      // "Admit all 4" for people who are already through. The server is the
      // authority and has already been told; this just stops the screen
      // contradicting it.
      const done = new Set(attendeeIds);
      setView((prev) =>
        prev
          ? {
              ...prev,
              alreadyAdmitted:
                prev.alreadyAdmitted ||
                prev.party.every((t) => t.alreadyAdmitted || done.has(t.attendeeId)),
              party: prev.party.map((t) =>
                done.has(t.attendeeId)
                  ? { ...t, alreadyAdmitted: true, admittedAt: new Date() }
                  : t,
              ),
            }
          : prev,
      );
      applyAdmit(res.data);
    })();
  }

  /** Debounced by the input; this just runs the query and keeps the last one. */
  function runSearch(q: string) {
    setSearching(true);
    void (async () => {
      const res = await searchGuests(eventId, q, eventCode);
      setSearching(false);
      setHits(res.ok ? res.data : []);
    })();
  }

  /** "Next guest" - the only exit from a standing verdict. */
  function resetWalkUp() {
    setWalkUpNonce((n) => n + 1);
  }

  function release() {
    setPhase(INITIAL_PHASE);
    setNudge(false);
    setHits(null);
    clearGuest();
  }

  /**
   * A tapped search result IS a resolved guest -- searchGuests returns the
   * same GateView a scan does, so the whole card below renders unchanged and
   * there is no second admit path to keep in step.
   */
  function pickHit(hit: GateView) {
    setHits(null);
    setPickupSel(new Set());
    setBuySel(new Map());
    setView(hit);
    if (hit.alreadyAdmitted) {
      settle(
        verdictFor({
          kind: "already",
          flow: "gate",
          at: hit.admittedAt ? formatVenueTime(new Date(hit.admittedAt)) : null,
        }),
        "acted",
      );
    }
  }

  function clearGuest() {
    setView(null);
    setPickupSel(new Set());
    setBuySel(new Map());
  }

  function onScan(code: string) {
    // THE LATCH. A standing verdict is not replaced by the next badge that
    // drifts into frame - see src/lib/scanLatch.ts. The drop is announced,
    // and deliberately makes no sound: silence means "ignored on purpose".
    // `guestPending` is part of the latch in practice: the phase says
    // `scanning` because a paid resolve does not settle, but a guest IS on
    // screen awaiting a tap, and re-reading their badge every 3 seconds is
    // what the cycling was.
    if (!acceptsDecode(phase) || (!!view && phase.phase !== "held")) {
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
      setBuySel(new Map());
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
      // Money already went back, or the sale was called off. Neither is
      // payable, and both used to read as "owes $0.00" because a REFUNDED
      // line is not a PENDING_PAYMENT one.
      if (isVoidOrder(g.orderStatus)) {
        return settle(
          verdictFor({ kind: "voidOrder", status: g.orderStatus as "REFUNDED" | "CANCELLED" }),
          "resolved",
        );
      }
      // Merch or a fee only. The server refuses this on admit anyway; saying
      // so NOW is the difference between a volunteer reading "sell them
      // admission" and a volunteer telling someone they are in and then
      // taking it back.
      if (g.admitsNobody) {
        return settle(verdictFor({ kind: "notATicket" }), "resolved");
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
      await doAdmitMany([view.attendeeId]);
    });
  }

  function doPayUnpaid() {
    if (!view) return;
    run(async () => {
      const res = await confirmUnpaidAndAdmit(view.orderId, view.attendeeId, eventId);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      applyAdmit(res.data);
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
      const res = await sellMerch(eventId, basketItems(buySel), view.attendeeId);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      settle(handedOver("Sold and handed over"));
      setBuySel(new Map());
      await refresh(campId);
    });
  }

  function doComp() {
    run(async () => {
      const res = await comp(eventId, compCount);
      if (!res.ok) return settle(verdictFor(signalForError(res.error)));
      void (res.data);
      settle({
        ...verdictFor({ kind: "admitted" }),
        headline: "Comped",
        detail: `${compCount} guest${compCount > 1 ? "s" : ""}`,
        instruction: `Give ${compCount} wristband${compCount > 1 ? "s" : ""}`,
      });
      setCompCount(1);
    });
  }

  // ── SCREEN MODE ────────────────────────────────────────────────────────
  // The redesign's central idea: ONE LAYOUT PER STATE, not every function
  // stacked at once. A 6" phone cannot hold scan + resolve + admit + search
  // + comp + sale simultaneously, so it holds whichever of them is the
  // volunteer's current job and nothing else.
  //
  //   scan   — camera takes the screen; dock offers the ways in
  //   held   — camera SHOWS the verdict; dock offers this guest's actions
  //   task   — camera collapses to a 52px strip; the task gets the space
  //
  // The whole thing is a fixed-height flex column that never scrolls: the
  // header and dock are flex-none, the camera is flex-1 and absorbs all the
  // slack. That is the mechanism, not the styling — it is why no CTA can end
  // up below the fold regardless of how tall a guest's actions get.
  const task: "none" | "search" | "comp" | "walkup" | "buy" =
    searchOpen ? "search"
    : compOpen ? "comp"
    : walkUp ? "walkup"
    : buyOpen ? "buy"
    : "none";
  const held = phase.phase === "held";
  const reading = phase.phase === "reading";
  const tone = held ? phase.verdict.tone : null;
  /**
   * A guest is on screen and nothing has happened to them yet.
   *
   * `onScan` deliberately does NOT latch the one case the volunteer can act
   * on -- "paid, here, not yet admitted" -- so the station stays in the
   * `scanning` phase. That was fine when the guest card hung below the
   * camera gated on `view`. This redesign gated the whole action dock on
   * `held`, so the commonest path at a door resolved, rendered NOTHING, and
   * left a live camera re-decoding the same ticket every 3 seconds:
   * Scanning -> Checking... -> Scanning, forever. Reported 2026-10-03.
   *
   * Treating it as its own state fixes both halves — the dock appears, and
   * the camera stops re-reading a ticket already on screen.
   */
  const guestPending = !!view && !held;

  /**
   * The band colour for a resolved-but-unacted guest.
   *
   * NOT always green: pickHit only settles an already-admitted guest, so a
   * will-call guest found by SEARCH lands here still owing money. Green for
   * "paid, ready", amber for "owes" -- the same meanings the verdict tones
   * carry, applied to a state that has no verdict of its own.
   */
  const pendingTone: ScanTone | null = guestPending && view
    ? view.isPaid
      ? "go"
      : "hold"
    : null;
  const camCollapsed = task !== "none";

  // Poll while a card sale is on screen. 2s is a door pace: fast enough that
  // the volunteer is not left wondering, slow enough that eight phones on one
  // hall NAT are not hammering the server. The webhook usually lands in well
  // under that.
  useEffect(() => {
    if (!cardSale) return;
    let stop = false;
    const started = Date.now();
    const id = setInterval(() => {
      setCardWaited(Math.round((Date.now() - started) / 1000));
      void (async () => {
        const res = await pollCardSale(cardSale.orderId, eventId);
        if (stop || !res.ok) return;
        if (!res.data.paid) return;
        // Paid AND admitted, in one server round trip. Clearing the sale
        // first means the verdict lands on a clean screen.
        setCardSale(null);
        settle(
          verdictFor({
            kind: "party",
            admitted: res.data.admitted,
            already: 0,
            at: null,
          }),
        );
        resetWalkUp();
        closeTask();
      })();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSale, eventId]);

  function closeTask() {
    setSearchOpen(false);
    setCompOpen(false);
    setWalkUp(false);
    setBuyOpen(false);
  }

  /**
   * Abandon a card sale from the gate.
   *
   * The ORDER IS LEFT ALONE, deliberately. It is PENDING with a live Stripe
   * session, and the guest may be mid-payment on their own phone right now —
   * cancelling it here would be the door voiding a charge it cannot see.
   * Stripe expires the session on its own (CHECKOUT_TTL_SECONDS), and
   * `checkout.session.expired` then reaps the order. Walking away is safe;
   * reaching across is not.
   */
  function abandonCardSale() {
    setCardSale(null);
    setCardWaited(0);
  }

  const pendingParty = view?.party.filter((t) => !t.alreadyAdmitted) ?? [];

  /**
   * How many of a multi-ticket order to let in RIGHT NOW.
   *
   * "Admit all 4" is the common case and stays one tap, but a family of four
   * routinely arrives as two now and two later, and the redesign replaced
   * the old per-ticket Admit buttons with pips — which are not tappable, so
   * all-or-nothing was the only option. Reported 2026-10-03.
   *
   * A COUNT, not a selection. These attendees have no names on this event
   * (collectsAttendeeDetails is false), so asking a volunteer to pick WHICH
   * of four identical rows is asking a question with no answer. "How many
   * are standing here" is the question they can actually answer.
   */
  const [admitN, setAdmitN] = useState(1);
  // Clamp to what is left, and default to everyone, whenever the guest
  // changes — otherwise a stepper left at 3 carries into the next party.
  useEffect(() => {
    setAdmitN(Math.max(1, pendingParty.length));
  }, [view?.orderId, pendingParty.length]);
  const partial = pendingParty.length > 1 && admitN < pendingParty.length;
  const unfulfilled = view?.pickupItems.filter((it) => !it.fulfilledAt) ?? [];

  /**
   * The one primary action for this guest, or null when there is nothing to
   * do but move on. Computed in ONE place so the button that admits and the
   * button that takes cash can never both appear, and so "no action" reliably
   * promotes "Next guest" to the full-width primary.
   */
  const primary: { label: string; onClick: () => void } | null = (() => {
    if (!view) return null;
    if (isVoidOrder(view.orderStatus)) return null;
    if (pickupSel.size > 0)
      return { label: `Hand over selected (${pickupSel.size})`, onClick: doPickup };
    if (buySel.size > 0 && canTakeCash)
      return {
        label: `Take cash ${formatCents(basketTotal(catalog.merch, buySel))} & hand over`,
        onClick: doBuyMore,
      };
    if (view.party.length > 1 && pendingParty.length > 0 && view.isPaid)
      return {
        label: partial
          ? `Admit ${admitN} of ${pendingParty.length}`
          : `Admit ${pendingParty.length === view.party.length ? "all" : "remaining"} ${pendingParty.length}`,
        onClick: () =>
          run(() =>
            doAdmitMany(pendingParty.slice(0, admitN).map((t) => t.attendeeId)),
          ),
      };
    if (view.alreadyAdmitted) return null;
    if (view.isPaid) return { label: "Admit & wristband", onClick: doAdmit };
    if (canTakeCash)
      return {
        label: `Take cash ${formatCents(view.amountOwedCents)} & admit`,
        onClick: doPayUnpaid,
      };
    return null;
  })();

  return (
    /* FIXED, FULL VIEWPORT. The gate is a kiosk: the site header, footer and
       help panel are what was eating the room the dock needs, and a volunteer
       at a door is not browsing the site. Navigation lives in the menu button
       in this screen's own header. `dvh` not `vh` — mobile browser chrome
       shrinks the viewport and `vh` would put the dock under it. */
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
      {/* ── Header, 56px, flex-none ───────────────────────────────────── */}
      <header className="flex h-14 flex-none items-center gap-2 border-b border-gray-200 bg-white pl-4 pr-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight">{eventName}</p>
          <p className="text-xs leading-tight text-gray-500">Gate</p>
        </div>
        <Link
          href="/staff"
          aria-label="Menu"
          className="flex h-12 w-12 items-center justify-center rounded-lg text-gray-600"
        >
          <span aria-hidden className="text-2xl leading-none">
            ☰
          </span>
        </Link>
      </header>

      {/* ── The camera band ───────────────────────────────────────────────
          [ x { y } x ] — the band IS the verdict. The colour surrounds the
          scan surface rather than sitting in a separate strip above it,
          because the volunteer's eyes are on the viewfinder: that is what
          they are aiming.

          The camera is NEVER UNMOUNTED, only collapsed, because tearing down
          html5-qrcode and re-acquiring the stream costs about a second and a
          permission round-trip on every state change. */}
      <div
        className={`mx-2 mt-2 flex min-h-0 flex-col rounded-2xl transition-colors ${
          camCollapsed ? "hidden" : "flex-1"
        } ${TONE_BAND[tone ?? pendingTone ?? "idle"]}`}
      >
        {/* Status chip row. THIS is where the latch becomes visible: a live
            feed that has stopped listening is indistinguishable from one that
            is, which is why the nudge existed at all. */}
        <div className="flex h-11 flex-none items-center justify-between gap-2 px-2.5">
          {/* THE CHIP REPORTS THE CAMERA, NOT THE LATCH. It used to derive
              purely from the latch phase, so it said "Scanning" when the
              camera had never been started — a volunteer held a ticket up to
              a dead viewfinder and the screen told them it was working.
              `camActive` comes from the scanner itself. */}
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black px-2.5 text-xs font-bold uppercase tracking-wide text-white">
            {reading ? (
              <>
                <span aria-hidden className="inline-block animate-spin">
                  ◠
                </span>
                Checking…
              </>
            ) : held ? (
              <>
                <span aria-hidden>❙❙</span>
                Camera paused
              </>
            ) : guestPending ? (
              <>
                <span aria-hidden>❙❙</span>
                Camera paused
              </>
            ) : camActive ? (
              <>
                <span aria-hidden className="animate-pulse">
                  ●
                </span>
                Scanning
              </>
            ) : (
              <>
                <span aria-hidden>○</span>
                Camera off
              </>
            )}
          </span>
          {(held || guestPending) && (
            /* MANDATORY beside a coloured band. Green here means "ready",
               not "in" -- without the word, a volunteer who has learned that
               green means admitted could wave this guest through without
               tapping Admit, and nothing would record it. */
            <span className="inline-flex h-7 items-center rounded-full bg-black px-2.5 text-xs font-extrabold tracking-wide text-white">
              {held
                ? TONE_WORD[phase.verdict.tone]
                : view?.isPaid
                  ? PENDING_WORD.paid
                  : PENDING_WORD.owes}
            </span>
          )}
        </div>

        {/* The scan surface itself, plus the verdict that replaces it. */}
        <div className="relative mx-2.5 mb-2.5 min-h-0 flex-1 overflow-hidden rounded-xl bg-gray-900">
          <QrScanner
            onScan={onScan}
            continuous
            fill
            onActiveChange={setCamActive}
          />
          {guestPending && view && (
            /* The band IS coloured here -- green for paid, amber for owing --
               because a volunteer scanning in a queue needs the at-a-glance
               read. What stops green meaning "already in" is the word beside
               it: READY · TAP ADMIT. */
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-20 flex flex-col gap-2.5 overflow-hidden bg-black/[.85] p-4"
            >
              <p className="text-[26px] font-extrabold leading-none tracking-tight text-white">
                {view.name ?? "Guest"}
              </p>
              <p className="text-base leading-snug text-gray-100">
                {view.isPaid
                  ? "Paid — ready to admit"
                  : `Owes ${formatCents(view.amountOwedCents)}`}
              </p>
              {view.party.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {view.party.map((t) => (
                    <span
                      key={t.attendeeId}
                      className={`h-5 w-5 rounded-full border-2 border-white ${
                        t.alreadyAdmitted ? "bg-white" : "bg-transparent"
                      }`}
                    />
                  ))}
                  <span className="ml-1 text-sm font-semibold text-gray-100">
                    {view.party.filter((t) => t.alreadyAdmitted).length} of{" "}
                    {view.party.length} in
                  </span>
                </div>
              )}
              <p className="font-mono text-xs text-gray-400">{view.campId}</p>
            </div>
          )}

          {held && (
            /* The verdict covers the feed rather than sitting beside it. It
               is opaque on purpose: a live picture behind a standing answer
               reads as "still working", which is the misunderstanding the
               latch exists to prevent. */
            <div
              role="status"
              aria-live="assertive"
              
              className="absolute inset-0 flex flex-col gap-2.5 overflow-hidden bg-black/[.85] p-4"
            >
              <div className="flex items-center gap-3">
                <ToneGlyph tone={phase.verdict.tone} />
                <p className="text-[26px] font-extrabold leading-none tracking-tight text-white">
                  {phase.verdict.headline}
                </p>
              </div>
              {phase.verdict.detail && (
                <p className="text-base leading-snug text-gray-100">
                  {phase.verdict.detail}
                </p>
              )}
              {view && view.party.length > 1 && (
                /* PIPS, NOT A LIST. This event does not collect attendee
                   names, so ten tickets render as ten identical rows that a
                   volunteer cannot tell apart and cannot fit on screen. A row
                   of filled/empty circles answers the only question the door
                   actually has: how many, and how many are already in. */
                <div className="flex flex-wrap items-center gap-1.5">
                  {view.party.map((t) => (
                    <span
                      key={t.attendeeId}
                      className={`h-5 w-5 rounded-full border-2 border-white ${
                        t.alreadyAdmitted ? "bg-white" : "bg-transparent"
                      }`}
                    />
                  ))}
                  <span className="ml-1 text-sm font-semibold text-gray-100">
                    {view.party.filter((t) => t.alreadyAdmitted).length} of{" "}
                    {view.party.length} in
                  </span>
                </div>
              )}
              {view?.campId && (
                <p className="font-mono text-xs text-gray-400">{view.campId}</p>
              )}
              <div className="flex-1" />
              {nudge && (
                <p className="flex items-start gap-2 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2.5 text-sm leading-snug text-gray-100">
                  <span aria-hidden>⃠</span>
                  Another code was scanned and ignored — finish this guest first.
                </p>
              )}
              {phase.verdict.instruction && (
                <p className="rounded-lg bg-white px-3.5 py-3 text-[17px] font-bold leading-snug text-gray-900">
                  {phase.verdict.instruction}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Collapsed camera strip, while a task has the screen ─────────── */}
      {camCollapsed && (
        <button
          type="button"
          onClick={closeTask}
          className="mx-2 mt-2 flex h-[52px] flex-none items-center gap-2.5 rounded-xl bg-gray-700 px-3.5 text-left text-sm font-semibold text-white"
        >
          <span aria-hidden className="text-lg">
            ❙❙
          </span>
          <span className="flex-1">Camera paused</span>
          <span className="font-bold underline underline-offset-2">Resume</span>
        </button>
      )}

      {/* ── The dock ──────────────────────────────────────────────────────
          flex-none and last, so it is pinned above the bottom edge where the
          thumb already rests, and cannot be pushed off by anything above. */}
      {task === "none" && !held && !guestPending && (
        <div className="flex flex-none flex-col gap-2 p-2 pb-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-[52px] items-center gap-2.5 rounded-lg border border-gray-400 bg-white px-3.5 text-left text-[15px] text-gray-500"
          >
            <span aria-hidden className="text-gray-700">
              ⌕
            </span>
            Ticket code or name
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCompOpen(true)}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-lg border border-gray-400 bg-white text-[15px] font-semibold"
            >
              Member comp
            </button>
            {/* OPEN TO EVERY GATE ROLE NOW. It used to be till-only, because
                a walk-up could only be paid in cash and tapping it without a
                till would 403. The card path takes no cash at the door, so
                gating this would block the auditable way to sell while
                leaving the cash one open to whoever does hold a till. The
                CASH BUTTON INSIDE is still till-only. */}
            {(
              <button
                type="button"
                onClick={() => setWalkUp(true)}
                className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-lg border border-gray-400 bg-white text-[15px] font-semibold"
              >
                Walk-up sale
              </button>
            )}
          </div>
        </div>
      )}

      {task === "none" && (held || guestPending) && (
        <div className="flex flex-none flex-col gap-2 p-2 pb-3">
          {/* Pre-bought merch, as tappable rows rather than checkboxes: a
              20px checkbox is not a 48px target. */}
          {view && unfulfilled.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="pl-1 text-xs font-bold uppercase tracking-wide text-gray-500">
                Pre-bought — hand over
              </p>
              {unfulfilled.map((it) => {
                const on = pickupSel.has(it.lineItemId);
                return (
                  <button
                    key={it.lineItemId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = new Set(pickupSel);
                      if (on) next.delete(it.lineItemId);
                      else next.add(it.lineItemId);
                      setPickupSel(next);
                    }}
                    className="flex h-[52px] items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 text-left text-[15px]"
                  >
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 border-gray-900 text-sm ${
                        on ? "bg-gray-900 text-white" : "text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="flex-1 font-semibold">{it.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selling merch to a guest already at the door. A cash path, so
              it is hidden outright without a till. */}
          {view &&
            canTakeCash &&
            catalog.merch.length > 0 &&
            !isVoidOrder(view.orderStatus) && (
              <button
                type="button"
                onClick={() => setBuyOpen(true)}
                className="flex h-[52px] items-center justify-center gap-2 rounded-lg border border-gray-400 bg-white text-[15px] font-semibold"
              >
                Buy merch
              </button>
            )}

          {view && isVoidOrder(view.orderStatus) && (
            <p className="rounded-lg border border-gray-400 bg-white px-3.5 py-3 text-[15px] font-semibold leading-snug">
              {view.orderStatus === "REFUNDED" ? "Refunded" : "Cancelled"} — this
              ticket cannot be settled here.
            </p>
          )}

          {/* Hidden, not greyed: a control you cannot use should not spend
              your attention, and tapping one would 403 and lose the guest. */}
          {view && !view.isPaid && !canTakeCash && !isVoidOrder(view.orderStatus) && (
            <p className="rounded-lg border border-gray-400 bg-white px-3.5 py-3 text-[15px] font-semibold leading-snug">
              Owes {formatCents(view.amountOwedCents)} — a till holder has to take
              this.
            </p>
          )}

          {/* HOW MANY ARE HERE. Only for a party with more than one still
              to come in, because for a single ticket the answer is one. */}
          {view && view.isPaid && pendingParty.length > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <span className="text-sm font-semibold">How many are here?</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="One fewer"
                  disabled={admitN <= 1}
                  onClick={() => setAdmitN((n) => Math.max(1, n - 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-400 text-xl font-bold disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-8 text-center text-xl font-bold tabular-nums">
                  {admitN}
                </span>
                <button
                  type="button"
                  aria-label="One more"
                  disabled={admitN >= pendingParty.length}
                  onClick={() =>
                    setAdmitN((n) => Math.min(pendingParty.length, n + 1))
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-400 text-xl font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {primary ? (
            <div className="flex gap-2">
              {/* Next guest is the SMALLER, left-hand, secondary button and
                  the primary is wider on the right. There is no undo at this
                  door, so the destructive-by-omission tap (moving on) must not
                  be the one the thumb finds first. */}
              <button
                type="button"
                onClick={release}
                className="flex h-14 flex-[0_0_34%] items-center justify-center gap-1.5 rounded-lg border border-gray-400 bg-white text-[15px] font-semibold"
              >
                Next guest
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={primary.onClick}
                className="flex h-14 min-w-0 flex-1 items-center justify-center rounded-lg bg-gray-900 px-3 text-center text-[15px] font-bold leading-tight text-white disabled:opacity-50"
              >
                {primary.label}
              </button>
            </div>
          ) : (
            /* ONE release control. "Done — next guest" is gone: it cleared the
               guest WITHOUT releasing the latch, so tapping it left the camera
               deaf with no sign of why. */
            <button
              type="button"
              onClick={release}
              className="flex h-14 items-center justify-center gap-2 rounded-lg bg-gray-900 text-base font-bold text-white"
            >
              Next guest
            </button>
          )}
        </div>
      )}

      {/* ── Task: find a guest ────────────────────────────────────────── */}
      {task === "search" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <GuestFinder
            eventCode={eventCode}
            disabled={pending}
            searching={searching}
            hits={hits}
            onLookup={(code) => {
              closeTask();
              onScan(code);
            }}
            onSearch={runSearch}
            onPick={(hit) => {
              closeTask();
              pickHit(hit);
            }}
          />
        </div>
      )}

      {/* ── Task: member comp ─────────────────────────────────────────── */}
      {task === "comp" && (
        <TaskSheet title="Member comp" desc="Check the membership card. Covers up to 4." onClose={closeTask}>
          <div className="flex flex-1 items-center justify-center gap-6">
            <Stepper value={compCount} onChange={setCompCount} min={1} max={4} />
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              closeTask();
              doComp();
            }}
            className="flex h-14 flex-none items-center justify-center rounded-lg bg-gray-900 text-base font-bold text-white disabled:opacity-50"
          >
            Comp {compCount} &amp; admit
          </button>
        </TaskSheet>
      )}

      {/* ── Waiting on a card payment ─────────────────────────────────── */}
      {cardSale && (
        <div className="m-2 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-lg font-bold">
            {formatCents(cardSale.totalCents)} — card
          </p>
          <p className="text-center text-sm leading-snug text-gray-600">
            Ask the guest to scan this with their phone camera and pay.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardSale.qr}
            alt="Scan to pay"
            className="h-56 w-56 flex-none rounded-lg border border-gray-200"
          />
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-semibold text-gray-700"
          >
            Waiting for payment… {cardWaited}s
          </p>
          {/* Honest about what cancelling does and does not do. The order and
              its Stripe session are left alone -- the guest may be mid-payment
              on their own phone, and the door must not void a charge it cannot
              see. Stripe expires the session itself. */}
          <p className="px-2 text-center text-xs leading-snug text-gray-500">
            Nothing is admitted until the payment clears. Walking away here does
            not cancel their payment — if they have already paid, scan their
            ticket as normal.
          </p>
          <div className="flex-1" />
          <button
            type="button"
            onClick={abandonCardSale}
            className="min-h-tap w-full flex-none rounded-lg border border-gray-400 font-semibold"
          >
            Stop waiting
          </button>
        </div>
      )}

      {/* ── Task: buy merch for a resolved guest ──────────────────────── */}
      {task === "buy" && canTakeCash && (
        <TaskSheet title="Buy merch" onClose={closeTask}>
          {/* No inner scroller: TaskSheet's body already scrolls, and two
              nested ones fight over the same drag. */}
          <ItemPicker items={catalog.merch} basket={buySel} onChange={setBuySel} />
          <button
            type="button"
            disabled={pending || buySel.size === 0}
            onClick={() => {
              closeTask();
              doBuyMore();
            }}
            className="flex h-14 flex-none items-center justify-center rounded-lg bg-gray-900 text-base font-bold text-white disabled:opacity-50"
          >
            Take cash {formatCents(basketTotal(catalog.merch, buySel))} &amp; hand over
          </button>
        </TaskSheet>
      )}

      {/* ── Task: walk-up sale ────────────────────────────────────────── */}
      {task === "walkup" && !cardSale && (
        <TaskSheet title="Walk-up sale" onClose={closeTask}>
          <WalkUpForm
            key={walkUpNonce}
            catalog={catalog}
            pending={pending}
            canTakeCash={canTakeCash}
            onCard={(items, name) =>
              run(async () => {
                const res = await startCardSale(eventId, items, name);
                if (!res.ok)
                  return settle(verdictFor(signalForError(res.error)));
                setCardWaited(0);
                setCardSale(res.data);
              })
            }
            onCancel={closeTask}
            onSubmit={(items, name) =>
              run(async () => {
                const res = await sellAndAdmit(eventId, items, name);
                if (!res.ok) return settle(verdictFor(signalForError(res.error)));
                void (res.data);
                closeTask();
                settle(verdictFor({ kind: "admitted", name: name || "Walk-up" }));
                resetWalkUp();
              })
            }
          />
        </TaskSheet>
      )}
    </div>
  );
}

/**
 * The verdict glyph, as a SHAPE and not only a colour.
 *
 * Green/amber/red alone fails for the ~1 in 12 men with a red-green
 * deficiency, and on a phone at minimum brightness in daylight the whole
 * screen is close to greyscale. Circle / triangle / octagon are the road-sign
 * vocabulary — they read at a glance, they read in monochrome, and they read
 * for someone who has never seen this screen before.
 */
function ToneGlyph({ tone }: { tone: ScanTone }) {
  if (tone === "go") {
    return (
      <span
        aria-hidden
        className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-green-600 text-3xl font-black text-white"
      >
        ✓
      </span>
    );
  }
  if (tone === "hold") {
    return (
      <span
        aria-hidden
        className="flex h-14 w-14 flex-none items-center justify-center bg-amber-400 text-3xl font-black text-gray-900"
        style={{ clipPath: "polygon(50% 4%, 96% 92%, 4% 92%)" }}
      >
        <span className="mt-2">!</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-14 w-14 flex-none items-center justify-center bg-red-600 text-3xl font-black text-white"
      style={{
        clipPath:
          "polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)",
      }}
    >
      ✕
    </span>
  );
}

/** A full-height task panel. The camera is a strip above it, not gone. */
function TaskSheet({
  title,
  desc,
  onClose,
  children,
}: {
  title: string;
  desc?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="m-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex h-12 flex-none items-center justify-between">
        <p className="text-[17px] font-bold">{title}</p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-12 w-12 items-center justify-center text-xl text-gray-500"
        >
          ✕
        </button>
      </div>
      {desc && (
        <p className="-mt-1.5 flex-none text-sm leading-snug text-gray-600">
          {desc}
        </p>
      )}
      {/* THE BODY SCROLLS. The sheet is `overflow-hidden` so it cannot push
          the kiosk column taller than the viewport — the whole screen is a
          fixed-height flex column and something has to absorb the overflow.
          Without a scroller here that clipping is silent: the walk-up form
          simply ended mid-button, and on a tall phone inside Gmail's
          in-app browser (which eats another ~90px of chrome) the Card
          button was off the bottom with no way to reach it. Reported from a
          Galaxy S25 Ultra, 2026-10-04.

          `min-h-0` is load-bearing: a flex child defaults to min-height
          auto, which refuses to shrink below its content, and the scroller
          never engages. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
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
/**
 * One box for every way a scan can fail.
 *
 * Replaces two adjacent controls that did almost the same thing: a fixed-prefix
 * manual-entry field, and (as of this change) a guest search. Deciding which to
 * use is not a decision a volunteer should make with a queue waiting.
 *
 * What the characters mean, in order:
 *   - looks like a WHOLE token (>= 8 chars, no hyphen) -> exact lookup, which
 *     also resolves across events so a wrong-event ticket names its real event
 *     instead of reporting "no match";
 *   - shorter, or contains a space or an @ -> search: token PREFIX within this
 *     event, plus name, email and phone.
 * Both run as you type; the exact lookup needs Enter, because firing an admit
 * path on a partial code would be its own bug.
 */
function GuestFinder({
  eventCode,
  disabled,
  searching,
  hits,
  onLookup,
  onSearch,
  onPick,
}: {
  eventCode: string;
  disabled: boolean;
  searching: boolean;
  hits: GateView[] | null;
  onLookup: (code: string) => void;
  onSearch: (q: string) => void;
  onPick: (hit: GateView) => void;
}) {
  const [q, setQ] = useState("");
  const seq = useRef(0);

  // 250ms, and a sequence guard so a slow early response cannot overwrite a
  // later one. Same pattern MemberSearch already uses.
  useEffect(() => {
    const value = q.trim();
    if (value.length < MIN_TOKEN_PREFIX) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      if (mine === seq.current) onSearch(value);
    }, 250);
    return () => clearTimeout(t);
    // onSearch is stable enough for this; re-running on identity would re-fire
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = expandTicketCode(eventCode, q);
          if (!code) return;
          onLookup(code);
          setQ("");
        }}
        className="flex gap-2"
      >
        {/* Prefix and field share one bordered box so they read as a single
            control. The border lives here, not on the input. It stays visible
            because it is what makes the short form obvious — but it is a hint
            now, not a constraint: a name typed here works too. */}
        <div className="flex min-h-tap w-full flex-1 items-center overflow-hidden rounded-lg border border-gray-300 bg-white px-3">
          <span className="shrink-0 select-none whitespace-nowrap text-base text-gray-500">
            {eventCode}-
          </span>
          <input
            className="w-full min-w-0 bg-transparent py-2 text-base outline-none"
            placeholder="K7M2XQ9T, or a name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label={`Ticket ID after the ${eventCode}- prefix, or a guest name`}
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

      {searching && <p className="text-sm text-gray-500">Searching…</p>}

      {hits !== null && !searching && (
        hits.length === 0 ? (
          <p className="text-sm text-gray-500">No guest matches that.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
            {hits.map((h) => (
              <li key={h.attendeeId}>
                <button
                  type="button"
                  onClick={() => onPick(h)}
                  className="flex min-h-tap w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {h.name ?? "Guest"}
                    </span>
                    <span className="block truncate font-mono text-xs text-gray-500">
                      {h.campId ?? "no code yet"}
                    </span>
                  </span>
                  {/* Status BEFORE the tap, so a volunteer scanning the list
                      knows which row is the one they want. */}
                  <span className="shrink-0 text-xs font-semibold">
                    {h.alreadyAdmitted ? (
                      <span className="text-gray-500">
                        in
                        {h.admittedAt
                          ? ` ${formatVenueTime(new Date(h.admittedAt))}`
                          : ""}
                      </span>
                    ) : isVoidOrder(h.orderStatus) ? (
                      // NOT "owes $0.00". A refunded order owes nothing because
                      // every line is REFUNDED rather than PENDING_PAYMENT, so
                      // the amount is a true zero and a badly misleading one:
                      // it reads as "nothing to pay, let them in".
                      <span className="text-red-700">
                        {h.orderStatus === "REFUNDED" ? "refunded" : "cancelled"}
                      </span>
                    ) : h.isPaid ? (
                      <span className="text-gray-700">paid</span>
                    ) : (
                      <span className="text-red-700">
                        owes {formatCents(h.amountOwedCents)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/**
 * Pick items AND how many of each.
 *
 * Tapping a chip still takes it 0 -> 1, so selling one of something is the same
 * single tap it has always been. At >= 1 the chip grows a stepper. The old
 * control wrote into a Set, which cannot hold a duplicate — that, not the
 * server, is why "three pairs of sticks" was unsellable at a door.
 */
function ItemPicker({
  items,
  basket,
  onChange,
}: {
  items: (CatalogItem & { colorHex?: string; remaining?: number | null })[];
  basket: Basket;
  onChange: (next: Basket) => void;
}) {
  function setQty(id: string, qty: number) {
    const next = new Map(basket);
    if (qty <= 0) next.delete(id);
    else next.set(id, qty);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const qty = basket.get(it.id) ?? 0;
        // Advisory only — the server still claims capacity atomically at
        // confirmation. Showing it stops the volunteer taking cash for six
        // when three are left, which is the failure this would otherwise
        // create far more often than it used to happen.
        const soldOut = it.remaining === 0;
        const ceiling = Math.min(
          GATE_MAX_QTY_PER_LINE,
          it.remaining ?? GATE_MAX_QTY_PER_LINE,
        );
        if (qty === 0) {
          return (
            <button
              key={it.id}
              type="button"
              disabled={soldOut}
              onClick={() => setQty(it.id, 1)}
              className="min-h-tap rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40"
            >
              {it.colorHex && (
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: it.colorHex }}
                />
              )}
              {it.name} · {formatCents(it.priceCents)}
              {soldOut && <span className="ml-1 text-xs">· sold out</span>}
            </button>
          );
        }
        return (
          <div
            key={it.id}
            className="flex min-h-tap items-center gap-1 rounded-full border border-brand bg-brand px-2 py-1 text-sm text-brand-fg"
          >
            <button
              type="button"
              aria-label={`One fewer ${it.name}`}
              onClick={() => setQty(it.id, qty - 1)}
              className="h-9 w-9 rounded-full text-lg font-bold"
            >
              −
            </button>
            <span className="min-w-[2ch] text-center tabular-nums font-semibold">
              {qty}
            </span>
            <button
              type="button"
              aria-label={`One more ${it.name}`}
              disabled={qty >= ceiling}
              onClick={() => setQty(it.id, qty + 1)}
              className="h-9 w-9 rounded-full text-lg font-bold disabled:opacity-40"
            >
              +
            </button>
            <span className="px-1">
              {it.name} · {formatCents(it.priceCents * qty)}
            </span>
          </div>
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
  onCard,
  canTakeCash,
}: {
  catalog: Catalog;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (items: GateSaleItem[], name: string) => void;
  /** Start a card sale: the guest pays on their own phone. */
  onCard: (items: GateSaleItem[], name: string) => void;
  /**
   * Whether to offer CASH. Card is offered to every gate role — a till is a
   * capability about handling notes, and the card path involves none.
   */
  canTakeCash: boolean;
}) {
  const [name, setName] = useState("");
  const [basket, setBasket] = useState<Basket>(new Map());
  const all = [...catalog.admission, ...catalog.merch, ...catalog.fees];
  const total = basketTotal(all, basket);

  return (
    <div className="space-y-3">

      <input
        className="min-h-tap w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {catalog.admission.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">Admission</p>
          <ItemPicker items={catalog.admission} basket={basket} onChange={setBasket} />
        </div>
      )}
      {catalog.merch.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">Merch</p>
          <ItemPicker items={catalog.merch} basket={basket} onChange={setBasket} />
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
          <ItemPicker items={catalog.fees} basket={basket} onChange={setBasket} />
          <p className="mt-2 text-xs font-semibold" style={{ color: "#a86800" }}>
            NOT A TICKET · NO FLOOR ACCESS
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {/* CARD FIRST when there is no till, because then it is the only way
            this volunteer can sell anything at all. */}
        <button
          type="button"
          disabled={pending || basket.size === 0}
          onClick={() => onCard(basketItems(basket), name)}
          className="min-h-tap w-full rounded-lg bg-gray-900 font-semibold text-white disabled:opacity-50"
        >
          Card {formatCents(total)} — guest pays on their phone
        </button>
        {canTakeCash && (
          <button
            type="button"
            disabled={pending || basket.size === 0}
            onClick={() => onSubmit(basketItems(basket), name)}
            className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
          >
            Take cash {formatCents(total)} &amp; admit{" "}
            {admitsCountFor(catalog.admission, basket)}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap w-full rounded-lg border border-gray-300 text-sm"
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

