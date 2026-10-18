"use client";

import type { ServiceKind } from "@prisma/client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { computeOrderFees, coverLabel, PLATFORM_FEE_LABEL, type FeePolicy } from "@/lib/fees";
import { trackBeginCheckout } from "@/lib/analyticsEvents";
import {
  clearDraft,
  hasEdits,
  loadDraft,
  saveDraft,
  snapshot,
  DRAFT_KEY,
} from "@/lib/checkoutDraft";
import { AddressInput } from "@/app/_components/AddressInput";
import { CheckoutReturnNotice } from "@/app/_components/CheckoutReturnNotice";
import {
  ValidatedInput,
  validateEmail,
  validateName,
  validatePhone,
} from "@/app/_components/ValidatedInput";
import { submitRegistration } from "./actions";

type Service = {
  key: string;
  name: string;
  priceCents: number;
  colorHex: string;
  kind: ServiceKind;
  /** Heads per unit: 1 for a ticket, 2 for a doubles entry, 8 for a table. */
  admitsCount: number;
};

type Plan = {
  id: string;
  name: string;
  termYears: number;
  priceCents: number;
  partySize: number;
};

type AttendeeForm = {
  name: string;
  mailingAddress: string;
  serviceKeys: string[];
};

const emptyAttendee = (): AttendeeForm => ({
  name: "",
  mailingAddress: "",
  serviceKeys: [],
});

/**
 * Everything the buyer typed, in one serialisable shape, so that backing out of
 * Stripe Checkout does not throw it away.
 *
 * `attendees` and `quantities` are the two that matter and the two most likely
 * to be quietly dropped by a restore: one is an array of objects with a nested
 * string array, the other a sparse record keyed by service. A restore that
 * brings back the contact fields and silently loses six attendees and their
 * addresses is worse than no restore at all, because the buyer will not notice
 * until the badges print.
 */
type RegisterDraft = {
  registrant: { name: string; email: string; phone: string };
  iAmAttending: boolean;
  marketingConsent: boolean;
  attendees: AttendeeForm[];
  quantities: Record<string, number>;
  /** Entrant names per service key, in seat order (quantity × admitsCount). */
  names: Record<string, string[]>;
  planId: string | null;
  donation: string;
  coverFee: boolean;
};

/**
 * Phone-first registration form. Two modes (collectsAttendeeDetails), plus an
 * optional donation, an optional family-membership add-on, and — on events that
 * honor membership — a compare where buying membership comps admission. Pricing
 * is display-only; the server recomputes the authoritative total.
 */
export function RegisterForm({
  eventId,
  services,
  collectsAttendeeDetails,
  namesAttendees = false,
  acceptsDonations,
  honorsMembership,
  allowsRefunds,
  plans,
  returnedFromCheckout,
  resumable,
  eventSlug,
  eventKind,
  feePolicy,
  orgName,
}: {
  eventId: string;
  services: Service[];
  collectsAttendeeDetails: boolean;
  /** Quantity mode: a name per admitted head (a player, a guest). The server insists; these inputs help. */
  namesAttendees?: boolean;
  acceptsDonations: boolean;
  honorsMembership: boolean;
  allowsRefunds: boolean;
  plans: Plan[];
  /** True when Stripe returned this buyer without payment (?cancelled=). */
  returnedFromCheckout: boolean;
  /** Set only when the server verified the resume cookie against that order. */
  resumable: { orderId: string; amountCents: number } | null;
  /**
   * Analytics dimensions only — never read by anything that decides what is
   * rendered or what is charged. Optional because `/register/page.tsx` does not
   * pass them yet: it resolves an event and hands down `event.id` plus the flags
   * this form needs, and `eventSlug()` needs name + code. Both are one line away
   * (`eventSlug={eventSlug(event)} eventKind={event.type}`), and until they are
   * passed the funnel still counts begin_checkout — it just cannot join it to
   * the `view_item` on `/e/<slug>` for the same event.
   */
  eventSlug?: string;
  eventKind?: string;
  /**
   * The organisation's fee policy as it applies today (src/lib/fees.ts), or
   * null when nothing is charged: no connected Stripe account, no policy. The
   * numbers shown here are the same pure math ensureFeeLines runs on the
   * server, so the Total line and the Stripe page agree to the cent.
   */
  feePolicy: FeePolicy | null;
  /** Named in the cover label: the money goes to them, not to the platform. */
  orgName: string;
}) {
  const [registrant, setRegistrant] = useState({ name: "", email: "", phone: "" });
  const [iAmAttending, setIAmAttending] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [attendees, setAttendees] = useState<AttendeeForm[]>([emptyAttendee()]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string[]>>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [donation, setDonation] = useState("");
  // Starts as the organisation set it (industry default on; an organisation
  // may default it off). It is the buyer's to clear in one tap, and it is
  // never a gratuity: the label names the exact amount and who receives it.
  const coverDefault = feePolicy?.feeCoverDefaultChecked ?? false;
  const [coverFee, setCoverFee] = useState(coverDefault);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const values: RegisterDraft = {
    registrant,
    iAmAttending,
    marketingConsent,
    attendees,
    quantities,
    names,
    planId,
    donation,
    coverFee,
  };

  /** Snapshot as restored, so `dirty` is a comparison rather than a flag
   *  threaded through every onChange in this file. */
  const baseline = useRef<string | null>(null);
  const restored = useRef(false);

  /**
   * Applied in an effect, NOT in a lazy useState initialiser: sessionStorage
   * does not exist during server rendering, so a lazy initialiser would render
   * empty on the server and populated on the client and React would resolve the
   * hydration mismatch by throwing one of them away. One frame of empty fields
   * is the cost, on a page just navigated to from another origin.
   */
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    if (!returnedFromCheckout) {
      // A fresh visit starts fresh, so a draft left behind by a completed
      // purchase cannot refill the form for the next buyer on this tab.
      clearDraft(DRAFT_KEY.register);
      return;
    }

    const draft = loadDraft<RegisterDraft>(DRAFT_KEY.register, eventId);
    if (!draft) {
      // No draft, but possibly still a resumable order — that is the tab-loss
      // case the resume cookie exists for. The baseline must be set ANYWAY, or
      // `dirty` below can never become true and the resume button would go on
      // offering the old order's total under a basket they have since rebuilt.
      baseline.current = snapshot(values);
      return;
    }

    const v = draft.values;
    // Guard the shapes rather than trusting them: this is JSON out of a browser
    // store, and an empty attendee list would render a form with no rows and no
    // way to add the first one.
    const applied: RegisterDraft = {
      ...v,
      attendees:
        Array.isArray(v.attendees) && v.attendees.length > 0
          ? v.attendees
          : [emptyAttendee()],
      quantities: v.quantities ?? {},
      names: v.names ?? {},
      planId: v.planId ?? null,
      donation: v.donation ?? "",
      coverFee: typeof v.coverFee === "boolean" ? v.coverFee : coverDefault,
    };

    setRegistrant(applied.registrant);
    setIAmAttending(applied.iAmAttending);
    setMarketingConsent(applied.marketingConsent);
    setAttendees(applied.attendees);
    setQuantities(applied.quantities);
    setNames(applied.names);
    setPlanId(applied.planId);
    setDonation(applied.donation);
    setCoverFee(applied.coverFee);
    // The APPLIED values, not the raw draft: if a guard above substituted
    // anything, comparing against the raw draft would read as an edit the buyer
    // never made and would retract the resume button on arrival.
    baseline.current = snapshot(applied);
    // `values` is read once, on mount, and the effect is guarded by
    // `restored` — it must not re-run when the buyer types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedFromCheckout, eventId]);

  /** Changed anything since landing back here? Retracts the resume offer — see
   *  CheckoutReturnNotice for why an edited form must not offer the old total. */
  const dirty = hasEdits(baseline.current, values);

  const priceOf = (key: string) =>
    services.find((s) => s.key === key)?.priceCents ?? 0;
  const isAdmission = (key: string) =>
    services.find((s) => s.key === key)?.kind === "ADMISSION";

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  const donationCents = Math.max(0, Math.round((Number(donation) || 0) * 100));

  // Admission comp: on a honoring event, a purchased membership comps admission.
  const admissionComped = Boolean(selectedPlan) && honorsMembership;

  // The cart as lines, in the shape the fee math reads, so the fee and the
  // cover are computed per unit exactly as the server will compute them.
  const cartLines = [
    ...(collectsAttendeeDetails
      ? attendees.flatMap((a) =>
          a.serviceKeys.map((k) => ({
            amountCents: admissionComped && isAdmission(k) ? 0 : priceOf(k),
            quantity: 1,
          })),
        )
      : services.map((svc) => ({
          amountCents: admissionComped && svc.kind === "ADMISSION" ? 0 : priceOf(svc.key),
          quantity: quantities[svc.key] ?? 0,
        }))),
    ...(selectedPlan
      ? [{ amountCents: selectedPlan.priceCents, quantity: 1, membershipPlanId: selectedPlan.id }]
      : []),
    ...(donationCents > 0 ? [{ amountCents: donationCents, quantity: 1, isDonation: true }] : []),
  ];
  const fees = computeOrderFees(cartLines, feePolicy, { coverProcessing: coverFee, orgName });
  // What ticking the box would add, shown on the label whether or not it is ticked.
  const coverIfTicked = coverFee
    ? fees.coverCents
    : computeOrderFees(cartLines, feePolicy, { coverProcessing: true, orgName }).coverCents;

  const total = fees.totalCents;

  // ── Attendee mode helpers ──
  function copyContactToFirstAttendee(name: string) {
    setAttendees((prev) =>
      prev.map((a, idx) => (idx === 0 ? { ...a, name } : a)),
    );
  }
  function onRegistrantName(name: string) {
    setRegistrant((r) => ({ ...r, name }));
    if (iAmAttending) copyContactToFirstAttendee(name);
  }
  function toggleIAmAttending(checked: boolean) {
    setIAmAttending(checked);
    if (checked) copyContactToFirstAttendee(registrant.name);
  }
  function toggleService(i: number, key: string) {
    setAttendees((prev) =>
      prev.map((a, idx) => {
        if (idx !== i) return a;
        const has = a.serviceKeys.includes(key);
        return {
          ...a,
          serviceKeys: has
            ? a.serviceKeys.filter((k) => k !== key)
            : [...a.serviceKeys, key],
        };
      }),
    );
  }
  function updateAttendee(i: number, patch: Partial<AttendeeForm>) {
    setAttendees((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function setQty(key: string, n: number) {
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, n) }));
  }

  /** How many names a service needs at its current quantity, when the event names its entrants. */
  function namesNeeded(s: Service): number {
    if (!namesAttendees || collectsAttendeeDetails || s.kind !== "ADMISSION") return 0;
    return (quantities[s.key] ?? 0) * Math.max(1, s.admitsCount);
  }
  function setEntrantName(key: string, index: number, value: string) {
    setNames((prev) => {
      const next = [...(prev[key] ?? [])];
      next[index] = value;
      return { ...prev, [key]: next };
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitRegistration({
        eventId,
        registrant,
        marketingConsent,
        membershipPlanId: planId ?? undefined,
        donationCents: donationCents > 0 ? donationCents : undefined,
        coverProcessingFee: coverFee,
        attendees: collectsAttendeeDetails
          ? attendees.map((a) => ({
              name: a.name,
              mailingAddress: a.mailingAddress || undefined,
              serviceKeys: a.serviceKeys,
            }))
          : undefined,
        quantities: collectsAttendeeDetails
          ? undefined
          : services
              .map((s) => {
                const needed = namesNeeded(s);
                return {
                  serviceKey: s.key,
                  quantity: quantities[s.key] ?? 0,
                  // Exactly the names this quantity needs, in seat order; the
                  // server refuses a short or blank list with the count.
                  ...(needed > 0
                    ? { names: Array.from({ length: needed }, (_, i) => names[s.key]?.[i] ?? "") }
                    : {}),
                };
              })
              .filter((q) => q.quantity > 0),
      });
      if (res.ok) {
        // GA4 funnel step 2, fired here and nowhere else: the order exists, the
        // redirect URL is in hand, and the next statement leaves this origin.
        //
        // Not on field interaction and not at the top of `submit()` — a
        // begin_checkout that fires before the server has accepted the order
        // would also count every validation bounce, and the whole point of this
        // event is to measure how many accepted checkouts never come back as a
        // purchase. Firing it on the failure path would make that ratio a
        // measure of our own error messages.
        //
        // Also fired for a $0 order, whose redirect goes straight to the
        // confirmation rather than to Stripe. Dropping those would leave the
        // free registrations as purchases with no begin_checkout, which reads in
        // the funnel as a step that can be skipped rather than as a free ticket.
        //
        // `total` is the DISPLAYED total. The server recomputes the
        // authoritative amount, so a hostile client could report a wrong value
        // here — acceptable for a funnel metric and the reason nothing about
        // money is decided from this number.
        trackBeginCheckout({ eventSlug, eventKind, valueCents: total });
        // Written immediately before the hop, because that hop is a full
        // document navigation to another origin — every useState above is about
        // to cease to exist. Keyed to the order just created so the return page
        // can tell this draft from a stale one.
        saveDraft<RegisterDraft>(DRAFT_KEY.register, {
          eventId,
          orderId: res.orderId,
          values,
        });
        window.location.href = res.redirectUrl;
      } else {
        setError(res.error);
      }
    });
  }

  const inputCls =
    "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

  return (
    <div className="mt-6 space-y-6">
      {returnedFromCheckout && (
        <CheckoutReturnNotice
          resumable={resumable}
          dirty={dirty}
          routes={{
            successPath: resumable ? `/confirm/${resumable.orderId}` : undefined,
            cancelPath: "/register",
          }}
        />
      )}

      {/* Registrant */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Your contact details
        </h2>
        {/* Name is a ValidatedInput too, since the server began trimming before
            measuring: a whitespace-only name is now refused, and without an
            inline check the buyer would learn that only after a submit round
            trip, in the page-level red box, away from the field at fault. */}
        <ValidatedInput
          className={inputCls}
          autoComplete="name"
          aria-label="Full name"
          placeholder="Full name"
          value={registrant.name}
          onChange={onRegistrantName}
          validate={validateName}
        />
        {/* Email and phone are ValidatedInput, not bare <input>: this page has no
            <form> element and the submit below is an onClick type="button", so
            native constraint validation never fires — type="email"/type="tel"
            only pick the mobile keyboard. The inline check is the whole
            mechanism; do not "simplify" it away as redundant with the input
            type. Its rules are looser than registrationSchema's on purpose. */}
        <ValidatedInput
          className={inputCls}
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
          value={registrant.email}
          onChange={(email) => setRegistrant((r) => ({ ...r, email }))}
          validate={validateEmail}
        />
        <ValidatedInput
          className={inputCls}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-label="Phone"
          placeholder="Phone"
          value={registrant.phone}
          onChange={(phone) => setRegistrant((r) => ({ ...r, phone }))}
          validate={validatePhone}
        />
        {collectsAttendeeDetails && (
          <label className="flex min-h-tap items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={iAmAttending}
              onChange={(e) => toggleIAmAttending(e.target.checked)}
            />
            I&apos;m also attending — use my details for Attendee 1
          </label>
        )}
      </section>

      {collectsAttendeeDetails ? (
        /* ── Attendee mode (camp / patient profiles) ── */
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Attendees
          </h2>
          {attendees.map((att, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Attendee {i + 1}</span>
                {attendees.length > 1 && (
                  <button
                    type="button"
                    className="min-h-tap px-2 text-sm text-red-600"
                    onClick={() =>
                      setAttendees((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-3 space-y-3">
                <input
                  className={inputCls}
                  placeholder="Attendee full name"
                  value={att.name}
                  onChange={(e) => updateAttendee(i, { name: e.target.value })}
                />
                <AddressInput
                  className={inputCls}
                  placeholder="Mailing address (for mailed labs)"
                  value={att.mailingAddress}
                  onChange={(v) => updateAttendee(i, { mailingAddress: v })}
                />
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Select services</p>
                  {services.map((s) => {
                    const checked = att.serviceKeys.includes(s.key);
                    const comped = admissionComped && s.kind === "ADMISSION";
                    return (
                      <label
                        key={s.key}
                        className={`flex min-h-tap cursor-pointer items-center justify-between rounded-lg border px-3 ${
                          checked ? "border-brand bg-brand/5" : "border-gray-200"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: s.colorHex }}
                          />
                          {s.name}
                        </span>
                        <span className="flex items-center gap-3 text-sm text-gray-600">
                          {comped
                            ? "Included"
                            : s.priceCents === 0
                              ? "Free"
                              : formatCents(s.priceCents)}
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={checked}
                            onChange={() => toggleService(i, s.key)}
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm text-gray-600"
            onClick={() => setAttendees((prev) => [...prev, emptyAttendee()])}
          >
            + Add another attendee
          </button>
        </section>
      ) : (
        /* ── Quantity mode (admission / merch) ── */
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Select quantity
          </h2>
          {services.map((s) => {
            const qty = quantities[s.key] ?? 0;
            const comped = admissionComped && s.kind === "ADMISSION";
            return (
              <div key={s.key} className="space-y-2">
              <div
                className={`flex min-h-tap items-center justify-between rounded-lg border px-3 py-2 ${
                  qty > 0 ? "border-brand bg-brand/5" : "border-gray-200"
                }`}
              >
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: s.colorHex }}
                  />
                  <span>
                    {s.name}
                    <span className="ml-2 text-gray-500">
                      {comped
                        ? "Included with membership"
                        : s.priceCents === 0
                          ? "Free"
                          : formatCents(s.priceCents)}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Remove one ${s.name}`}
                    className="h-9 w-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-700 disabled:opacity-40"
                    disabled={qty === 0}
                    onClick={() => setQty(s.key, qty - 1)}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-base font-semibold">{qty}</span>
                  <button
                    type="button"
                    aria-label={`Add one ${s.name}`}
                    className="h-9 w-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-700"
                    onClick={() => setQty(s.key, qty + 1)}
                  >
                    +
                  </button>
                </span>
                </div>
                {/* One name per head, grouped by unit so a doubles pair reads
                    as a pair. Rendered only when the event asks; the server
                    is what refuses a missing one. */}
                {namesNeeded(s) > 0 && (
                  <div className="space-y-2 rounded-lg border border-gray-200 px-3 py-2">
                    {Array.from({ length: namesNeeded(s) }, (_, i) => {
                      const heads = Math.max(1, s.admitsCount);
                      const unit = Math.floor(i / heads) + 1;
                      const slot = (i % heads) + 1;
                      const label =
                        heads > 1
                          ? `${s.name} ${unit} — ${slot === 1 ? "player 1" : `player ${slot} (partner)`}`
                          : `${s.name} ${unit} — name`;
                      return (
                        <label key={i} className="block text-xs text-gray-600">
                          {label}
                          <input
                            className={inputCls}
                            placeholder="Full name"
                            autoComplete="off"
                            value={names[s.key]?.[i] ?? ""}
                            onChange={(e) => setEntrantName(s.key, i, e.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-gray-400">
            Each admission counts as one entry — you&apos;ll get a QR per entry to
            scan at the door.
          </p>
        </section>
      )}

      {/* Membership add-on / compare */}
      {plans.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Family membership
          </h2>
          {honorsMembership && (
            <p className="text-xs text-gray-500">
              Members get free entry for the family at this event — compare buying
              admission above vs. a membership below.
            </p>
          )}
          <label
            className={`flex min-h-tap cursor-pointer items-center justify-between rounded-lg border px-3 ${
              planId === null ? "border-brand bg-brand/5" : "border-gray-200"
            }`}
          >
            <span className="text-sm">No membership</span>
            <input
              type="radio"
              name="plan"
              className="h-5 w-5"
              checked={planId === null}
              onChange={() => setPlanId(null)}
            />
          </label>
          {plans.map((p) => (
            <label
              key={p.id}
              className={`flex min-h-tap cursor-pointer items-center justify-between rounded-lg border px-3 ${
                planId === p.id ? "border-brand bg-brand/5" : "border-gray-200"
              }`}
            >
              <span className="text-sm">
                {p.name}
                <span className="ml-2 text-xs text-gray-500">
                  family of {p.partySize} · {p.termYears}yr
                </span>
              </span>
              <span className="flex items-center gap-3 text-sm text-gray-600">
                {formatCents(p.priceCents)}
                <input
                  type="radio"
                  name="plan"
                  className="h-5 w-5"
                  checked={planId === p.id}
                  onChange={() => setPlanId(p.id)}
                />
              </span>
            </label>
          ))}
        </section>
      )}

      {/* Donation */}
      {acceptsDonations && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Add a donation (optional)
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">$</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              className={inputCls}
              placeholder="0"
              value={donation}
              onChange={(e) => setDonation(e.target.value)}
            />
          </div>
        </section>
      )}

      {/* Service fee + processing-cost cover. The fee is a disclosed line,
          never a box the buyer could have missed; the cover is the ONE box,
          it names its exact amount and its recipient, and one tap clears it.
          Hidden entirely while the cart is empty — there is nothing to fee. */}
      {feePolicy && fees.subtotalCents > 0 && (
        <section className="space-y-2">
          {fees.buyerFeeCents > 0 && (
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>{PLATFORM_FEE_LABEL}</span>
              <span>{formatCents(fees.buyerFeeCents)}</span>
            </div>
          )}
          {feePolicy.allowBuyerCover && coverIfTicked > 0 && (
            <label className="flex min-h-tap items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={coverFee}
                onChange={(e) => setCoverFee(e.target.checked)}
              />
              {coverLabel(coverIfTicked, orgName)}
            </label>
          )}
        </section>
      )}

      {/* Consent */}
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
        />
        Keep me posted about future camps and events.
      </label>

      {/* This line is the authoritative refund policy: the help panel on
          /register points at it rather than restating it, so the two must not
          drift apart. The true branch used to name a circumstance ("considered
          only if the event is rescheduled"), which reads as a promise of money
          back before the buyer has paid — the exact phrasing the plan bans on
          every screen. It now says only WHO handles a refund and that there is
          no self-serve path, word for word the sentence the help panel opens
          with. Do not reintroduce an eligibility condition, an outcome, or a
          timeframe here; whether this event may be refunded at all is the
          admin's call via the flag, not a sentence on the checkout. */}
      <p className="text-xs text-gray-400">
        {allowsRefunds
          ? "Refunds are handled by staff, not online — there is no self-serve refund in this form."
          : "All sales are final — no refunds, including no-shows."}
      </p>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Total + submit */}
      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Total</span>
          <span className="text-lg font-bold">{formatCents(total)}</span>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="mt-2 min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {pending
            ? "Working…"
            : total === 0
              ? "Complete registration"
              : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}
