"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchMembers, type MemberSearchRow } from "./actions";

const inputCls = "min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

/** Format a 10-digit string as (xxx) xxx-xxxx; leave anything else as-is. */
function fmtPhone(p: string | null): string {
  if (!p) return "";
  return /^\d{10}$/.test(p) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
}

export function MemberSearch({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MemberSearchRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  // Debounce: search 250ms after typing stops; ignore stale responses.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      setSearched(false);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchMembers(term);
        if (id === seq.current) {
          setRows(res);
          setSearched(true);
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-3">
      <input
        className={`w-full ${inputCls}`}
        type="search"
        inputMode="search"
        placeholder={`Search ${total} members by name, email, or phone`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search members"
      />

      {q.trim().length >= 2 && (
        <p className="text-xs text-gray-400">
          {pending
            ? "Searching…"
            : searched
              ? `${rows.length}${rows.length === 50 ? "+" : ""} match${rows.length === 1 ? "" : "es"}`
              : ""}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((m) => (
          <li
            key={m.id}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{m.name}</span>
              <StatusPill row={m} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {m.email.endsWith("@dcica.invalid") ? (
                <span className="italic text-gray-400">no email on file</span>
              ) : (
                m.email
              )}
              {m.phone && <span className="ml-2">· {fmtPhone(m.phone)}</span>}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Family of {m.partySize}
            </p>
          </li>
        ))}
      </ul>

      {searched && !pending && rows.length === 0 && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
          No members match “{q.trim()}”.
        </p>
      )}
    </div>
  );
}

function StatusPill({ row }: { row: MemberSearchRow }) {
  const isLife = new Date(row.validTo).getUTCFullYear() >= 2099;
  if (isLife) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        LIFE
      </span>
    );
  }
  const through = new Date(row.validTo).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
  return row.isCurrent ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Current · {through}
    </span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      Expired · {through}
    </span>
  );
}
