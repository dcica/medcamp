import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";

/**
 * Tenant-scoped authorization. Role lives on Membership (per org), not on the
 * session token — so we resolve it per request against the active org. This is
 * the AUTHORITATIVE access check; middleware is only an optimistic UX gate.
 *
 * Coordinator is the superuser: it satisfies every requireRole() check.
 */

export type CurrentMember = {
  userId: string;
  email: string;
  name: string | null;
  orgId: string;
  role: Role;
  canHoldTill: boolean;
};

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const org = await getActiveOrg();
  if (!org) return null;

  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: org.id, userId: session.user.id } },
  });
  if (!membership) return null;

  return {
    userId: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    orgId: org.id,
    role: membership.role,
    canHoldTill: membership.canHoldTill,
  };
}

/** Require a signed-in member of the active org, else redirect to login. */
export async function requireMember(callbackUrl?: string): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) {
    redirect(
      callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login",
    );
  }
  return member;
}

/**
 * The two authorization DECISIONS, separated from the redirects that enforce
 * them. `requireRole`/`requireTill` need a request (session cookie, active org),
 * so the rule inside them can only be exercised through a browser; as plain
 * predicates over a Membership row they can be pinned in a script — which is
 * what scripts/verify-gate.ts does with real rows from the database.
 */

/** Does this role satisfy a requireRole(...) check? Coordinator is the superuser. */
export function satisfiesRole(role: Role, allowed: readonly Role[]): boolean {
  return role === "COORDINATOR" || allowed.includes(role);
}

/**
 * May this member record CASH? A capability on the membership, not a role — a
 * coordinator assigns the till before the event, and a registration-desk
 * volunteer without one may still take card and print badges.
 */
export function canRecordCash(member: {
  role: Role;
  canHoldTill: boolean;
}): boolean {
  return member.role === "COORDINATOR" || member.canHoldTill;
}

/**
 * Require one of the given roles (Coordinator always passes). Redirects to
 * /login if unauthenticated and /403 if authenticated but unauthorized.
 */
export async function requireRole(...roles: Role[]): Promise<CurrentMember> {
  const member = await requireMember();
  if (!satisfiesRole(member.role, roles)) {
    redirect("/403");
  }
  return member;
}

/** Require till-holder capability (server-side guard for cash payments). */
export async function requireTill(): Promise<CurrentMember> {
  const member = await requireMember();
  if (!canRecordCash(member)) {
    redirect("/403");
  }
  return member;
}
