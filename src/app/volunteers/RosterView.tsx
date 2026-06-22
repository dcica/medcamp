"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SignupStatus } from "@prisma/client";
import type { VolunteerRoster } from "@/server/volunteers";
import { sourceLabel } from "@/lib/volunteerRoles";
import {
  sendRemindersAction,
  issueCertificatesAction,
  setHoursAction,
  markNoShowAction,
} from "./actions";

const STATUS_STYLE: Record<SignupStatus, string> = {
  SIGNED_UP: "bg-gray-100 text-gray-600",
  WAITLISTED: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  CHECKED_IN: "bg-green-100 text-green-700",
  CHECKED_OUT: "bg-teal-100 text-teal-700",
  NO_SHOW: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-400 line-through",
};

const STATUS_LABEL: Record<SignupStatus, string> = {
  SIGNED_UP: "Signed up",
  WAITLISTED: "Waitlist",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "On site",
  CHECKED_OUT: "Checked out",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

export function RosterView({
  roster,
  eventId,
}: {
  roster: VolunteerRoster;
  eventId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
      else {
        if (res.message) setNotice(res.message);
        router.refresh();
      }
    });
  }

  const s = roster.summary;

  return (
    <div className="space-y-6">
      {/* Coordinator actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => sendRemindersAction(eventId))}
          className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm font-medium disabled:opacity-50"
        >
          Send 24–48h reminders
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => issueCertificatesAction(eventId))}
          className="min-h-tap rounded-lg border border-gray-300 px-3 text-sm font-medium disabled:opacity-50"
        >
          Issue certificates
        </button>
        <a
          href={`/api/reports/volunteers?event=${eventId}`}
          className="min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium"
        >
          Export roster CSV ↓
        </a>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Tile label="Signed up" value={s.total} />
        <Tile label="On site" value={s.onSite} />
        <Tile label="Checked out" value={s.checkedOut} />
        <Tile label="Waitlist" value={s.waitlisted} />
        <Tile label="No-shows" value={s.noShow} />
      </div>

      {/* Capacity by role */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Capacity by role
        </h2>
        <ul className="space-y-2">
          {roster.roles.map((r) => {
            const under = r.capacity > 0 && r.filled < r.capacity;
            return (
              <li
                key={r.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  under ? "border-amber-300 bg-amber-50" : "border-gray-200"
                }`}
              >
                <span>
                  {r.name}
                  {r.shift && <span className="text-gray-400"> · {r.shift}</span>}
                </span>
                <span className="font-medium">
                  {r.filled}
                  {r.capacity > 0 ? `/${r.capacity}` : ""}
                  {under && (
                    <span className="ml-2 text-xs text-amber-700">understaffed</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Signups by source */}
      {roster.bySource.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Signups by source
          </h2>
          <div className="flex flex-wrap gap-2">
            {roster.bySource.map((b) => (
              <span
                key={b.tag}
                className="rounded-full border border-gray-200 px-3 py-1 text-sm"
              >
                {b.label}: <span className="font-semibold">{b.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Roster */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Roster ({roster.rows.length})
        </h2>
        <ul className="space-y-2">
          {roster.rows.map((row) => (
            <li
              key={row.signupId}
              className="rounded-xl border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {row.roleName}
                    {row.school && ` · ${row.school}`}
                    {row.counselorName && ` · advisor: ${row.counselorName}`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {sourceLabel(row.sourceTag)}
                    {row.code && ` · ${row.code}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span>In: {fmtTime(row.checkedInAt)}</span>
                <span>Out: {fmtTime(row.checkedOutAt)}</span>
                <HoursEditor
                  signupId={row.signupId}
                  hours={row.hoursServed}
                  pending={pending}
                  run={run}
                />
                {row.status !== "NO_SHOW" &&
                  row.status !== "CHECKED_OUT" &&
                  row.status !== "CANCELLED" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => markNoShowAction(row.signupId))}
                      className="text-red-600 underline disabled:opacity-40"
                    >
                      Mark no-show
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function HoursEditor({
  signupId,
  hours,
  pending,
  run,
}: {
  signupId: string;
  hours: number | null;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(hours != null ? String(hours) : "");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="underline"
      >
        Hours: {hours != null ? hours.toFixed(1) : "—"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        step="0.1"
        min="0"
        className="w-16 rounded border border-gray-300 px-1 py-0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          run(() => setHoursAction(signupId, Number(value)));
          setEditing(false);
        }}
        className="text-brand underline disabled:opacity-40"
      >
        save
      </button>
    </span>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function fmtTime(d: Date | null): string {
  return d
    ? new Date(d).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
}
