"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { submitRegistration } from "./actions";

type Service = {
  key: string;
  name: string;
  priceCents: number;
  colorHex: string;
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
 * Phone-first registration form (UI Constraint: 6" phone, 48px taps, single
 * column, no horizontal scroll). Pricing is display-only; the server recomputes
 * totals from the menu so the client can't tamper with prices.
 */
export function RegisterForm({
  eventId,
  services,
}: {
  eventId: string;
  services: Service[];
}) {
  const [registrant, setRegistrant] = useState({ name: "", email: "", phone: "" });
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [attendees, setAttendees] = useState<AttendeeForm[]>([emptyAttendee()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const priceOf = (key: string) =>
    services.find((s) => s.key === key)?.priceCents ?? 0;

  const total = attendees.reduce(
    (sum, a) => sum + a.serviceKeys.reduce((s, k) => s + priceOf(k), 0),
    0,
  );

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

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitRegistration({
        eventId,
        registrant,
        marketingConsent,
        attendees: attendees.map((a) => ({
          name: a.name,
          mailingAddress: a.mailingAddress || undefined,
          serviceKeys: a.serviceKeys,
        })),
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
          onChange={(e) => setRegistrant({ ...registrant, name: e.target.value })}
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
      </section>

      {/* Attendees */}
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
              <input
                className={inputCls}
                placeholder="Mailing address (for mailed labs)"
                value={att.mailingAddress}
                onChange={(e) =>
                  updateAttendee(i, { mailingAddress: e.target.value })
                }
              />
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Select services</p>
                {services.map((s) => {
                  const checked = att.serviceKeys.includes(s.key);
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
                        {s.priceCents === 0 ? "Free" : formatCents(s.priceCents)}
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
