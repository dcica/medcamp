"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import {
  startVisitAction,
  completeVisitAction,
  addOnsiteServiceAction,
} from "../actions";

type Entry = {
  visitId: string;
  attendeeId: string;
  campId: string;
  name: string | null;
  status: "QUEUED" | "IN_PROGRESS";
  needsPayment: boolean;
  services: { name: string; colorHex: string }[];
};

type Service = { id: string; name: string; priceCents: number };

export function QueueView({
  stationKey,
  inProgress,
  waiting,
  canAddOn,
  services,
}: {
  stationKey: string;
  inProgress: Entry[];
  waiting: Entry[];
  canAddOn: boolean;
  services: Service[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Lightweight live-ish refresh until Supabase Realtime lands (Module 4).
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <Section title={`In progress (${inProgress.length})`}>
        {inProgress.map((e) => (
          <Card
            key={e.visitId}
            e={e}
            stationKey={stationKey}
            canAddOn={canAddOn}
            services={services}
            pending={pending}
            run={run}
          />
        ))}
        {inProgress.length === 0 && <Empty>Nobody in progress.</Empty>}
      </Section>

      <Section title={`Waiting (${waiting.length})`}>
        {waiting.map((e) => (
          <Card
            key={e.visitId}
            e={e}
            stationKey={stationKey}
            canAddOn={canAddOn}
            services={services}
            pending={pending}
            run={run}
          />
        ))}
        {waiting.length === 0 && <Empty>Queue is empty.</Empty>}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-400">
      {children}
    </li>
  );
}

function Card({
  e,
  stationKey,
  canAddOn,
  services,
  pending,
  run,
}: {
  e: Entry;
  stationKey: string;
  canAddOn: boolean;
  services: Service[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold">{e.name ?? e.campId}</span>
          <span className="ml-2 font-mono text-xs text-gray-500">{e.campId}</span>
        </div>
        {e.needsPayment && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Needs payment
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.services.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.colorHex }}
            />
            {s.name}
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        {e.status === "QUEUED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => startVisitAction(e.visitId, stationKey))}
            className="min-h-tap flex-1 rounded-lg border border-brand text-sm font-semibold text-brand disabled:opacity-50"
          >
            Start
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => completeVisitAction(e.visitId, stationKey))}
          className="min-h-tap flex-1 rounded-lg bg-brand text-sm font-semibold text-brand-fg disabled:opacity-50"
        >
          Done → next
        </button>
      </div>

      {canAddOn && (
        <div className="mt-2">
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="min-h-tap w-full rounded-lg border border-dashed border-gray-300 text-sm text-gray-600"
            >
              + Add service (doctor)
            </button>
          ) : (
            <div className="flex gap-2">
              <select
                className="min-h-tap flex-1 rounded-lg border border-gray-300 px-2 text-sm"
                value={serviceId}
                onChange={(ev) => setServiceId(ev.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatCents(s.priceCents)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending || !serviceId}
                onClick={() =>
                  run(async () => {
                    const res = await addOnsiteServiceAction(
                      e.attendeeId,
                      serviceId,
                      stationKey,
                    );
                    if (res.ok) setAdding(false);
                    return res;
                  })
                }
                className="min-h-tap rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg disabled:opacity-50"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
