"use client";

import { useState, useTransition } from "react";
import type { Role } from "@prisma/client";
import { ROLES } from "@/lib/roles";
import {
  inviteMember,
  updateMembership,
  removeMembership,
  revokeInvite,
} from "./actions";

export type MemberRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  canHoldTill: boolean;
  canOverrideWaiver: boolean;
  isSelf: boolean;
};

export type InviteRow = {
  id: string;
  email: string;
  role: Role;
};

const inputCls =
  "min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function MembersManager({
  members,
  invites,
}: {
  members: MemberRow[];
  invites: InviteRow[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Invite form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STATION_VOLUNTEER");
  const [till, setTill] = useState(false);
  const [override, setOverride] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Invite */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Invite a member
        </h2>
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <input
            className={`w-full ${inputCls}`}
            type="email"
            placeholder="email@example.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className={`w-full ${inputCls}`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <label className="flex min-h-tap items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={till}
              onChange={(e) => setTill(e.target.checked)}
            />
            Can hold a till (handle cash)
          </label>
          <label className="flex min-h-tap items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Waiver override authority
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await inviteMember({
                  email,
                  role,
                  canHoldTill: till,
                  canOverrideWaiver: override,
                });
                if (res.ok) {
                  setEmail("");
                  setTill(false);
                  setOverride(false);
                }
                return res;
              })
            }
            className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
          >
            Send invite
          </button>
          <p className="text-xs text-gray-400">
            The invite is redeemed automatically when they first sign in with that
            email.
          </p>
        </div>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Pending invites
          </h2>
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <span>
                  {inv.email}
                  <span className="ml-2 text-xs text-gray-400">
                    {ROLES.find((r) => r.value === inv.role)?.label}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => revokeInvite(inv.id))}
                  className="min-h-tap px-2 text-red-600"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Members */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Members ({members.length})
        </h2>
        <ul className="space-y-3">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} pending={pending} run={run} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function MemberCard({
  member,
  pending,
  run,
}: {
  member: MemberRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [till, setTill] = useState(member.canHoldTill);
  const [override, setOverride] = useState(member.canOverrideWaiver);

  const dirty =
    role !== member.role ||
    till !== member.canHoldTill ||
    override !== member.canOverrideWaiver;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {member.name ?? member.email}
          {member.isSelf && (
            <span className="ml-2 text-xs text-gray-400">(you)</span>
          )}
        </span>
        {!member.isSelf && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => removeMembership(member.id))}
            className="min-h-tap px-2 text-sm text-red-600"
          >
            Remove
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">{member.email}</p>

      <div className="mt-3 space-y-2">
        <select
          className={`w-full ${inputCls}`}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="flex min-h-tap items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={till}
            onChange={(e) => setTill(e.target.checked)}
          />
          Can hold a till
        </label>
        <label className="flex min-h-tap items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />
          Waiver override
        </label>
        {dirty && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                updateMembership(member.id, {
                  role,
                  canHoldTill: till,
                  canOverrideWaiver: override,
                }),
              )
            }
            className="min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg disabled:opacity-50"
          >
            Save changes
          </button>
        )}
      </div>
    </li>
  );
}
