"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { AddressInput } from "@/app/_components/AddressInput";
import { submitRegistration } from "./actions";

type Service = {
  key: string;
  name: string;
  priceCents: number;
  colorHex: string;
  fulfillable: boolean;
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
 * Phone-first registration form. Two modes (collectsAttendeeDetails), plus an
 * optional donation, an optional family-membership add-on, and — on events that
 * honor membership — a compare where buying membership comps admission. Pricing
 * is display-only; the server recomputes the authoritative total.
 */
export function RegisterForm({
  eventId,
  services,
  collectsAttendeeDetails,
  acceptsDonations,
  honorsMembership,
  allowsRefunds,
  plans,
}: {
  eventId: string;
  services: Service[];
  collectsAttendeeDetails: boolean;
  acceptsDonations: boolean;
  honorsMembership: boolean;
  allowsRefunds: boolean;
  plans: Plan[];
}) {
  const [registrant, setRegistrant] = useState({ name: "", email: "", phone: "" });
  const [iAmAttending, setIAmAttending] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [attendees, setAttendees] = useState<AttendeeForm[]>([emptyAttendee()]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [donation, setDonation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const priceOf = (key: string) =>
    services.find((s) => s.key === key)?.priceCents ?? 0;
  const isAdmission = (key: string) =>
    !services.find((s) => s.key === key)?.fulfillable;

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  const donationCents = Math.max(0, Math.round((Number(donation) || 0) * 100));

  // Admission comp: on a honoring event, a purchased membership comps admission.
  const admissionComped = Boolean(selectedPlan) && honorsMembership;

  const servicesCost = collectsAttendeeDetails
    ? attendees.reduce(
        (sum, a) =>
          sum +
          a.serviceKeys.reduce(
            (s, k) => s + (admissionComped && isAdmission(k) ? 0 : priceOf(k)),
            0,
          ),
        0,
      )
    : services.reduce(
        (s, svc) =>
          s +
          (admissionComped && !svc.fulfillable ? 0 : priceOf(svc.key)) *
            (quantities[svc.key] ?? 0),
        0,
      );

  const total = servicesCost + (selectedPlan?.priceCents ?? 0) + donationCents;

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

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitRegistration({
        eventId,
        registrant,
        marketingConsent,
        membershipPlanId: planId ?? undefined,
        donationCents: donationCents > 0 ? donationCents : undefined,
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
              .map((s) => ({ serviceKey: s.key, quantity: quantities[s.key] ?? 0 }))
              .filter((q) => q.quantity > 0),
      });
      if (res.ok) {
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
      {/* Registrant */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Your contact details
        </h2>
        <input
          className={inputCls}
          placeholder="Full name"
          value={registrant.name}
          onChange={(e) => onRegistrantName(e.target.value)}
        />
        <input
          className={inputCls}
          type="email"
          placeholder="Email"
          value={registrant.email}
          onChange={(e) => setRegistrant({ ...registrant, email: e.target.value })}
        />
        <input
          className={inputCls}
          type="tel"
          placeholder="Phone"
          value={registrant.phone}
          onChange={(e) => setRegistrant({ ...registrant, phone: e.target.value })}
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
                    const comped = admissionComped && !s.fulfillable;
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
            const comped = admissionComped && !s.fulfillable;
            return (
              <div
                key={s.key}
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

      <p className="text-xs text-gray-400">
        {allowsRefunds
          ? "Refunds are considered only if the event is rescheduled, and are handled by staff."
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
