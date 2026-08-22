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
 * Require one of the given roles (Coordinator always passes). Redirects to
 * /login if unauthenticated and /403 if authenticated but unauthorized.
 */
export async function requireRole(...roles: Role[]): Promise<CurrentMember> {
  const member = await requireMember();
  if (member.role !== "COORDINATOR" && !roles.includes(member.role)) {
    redirect("/403");
  }
  return member;
}

/** Require till-holder capability (server-side guard for cash payments). */
export async function requireTill(): Promise<CurrentMember> {
  const member = await requireMember();
  if (member.role !== "COORDINATOR" && !member.canHoldTill) {
    redirect("/403");
  }
  return member;
}

// ── Per-event authorization ──────────────────────────────────────────────────

/**
 * A member's authority AT ONE EVENT, which is not the same thing as their
 * authority in the org.
 *
 * WHY THIS EXISTS. `Membership` is `@@unique([orgId, userId])` — one role per
 * person per org, permanently — but CLAUDE.md says "Till holders are assigned by
 * the coordinator before camp." The domain has always been per-event; the schema
 * never was. Today, making someone a till holder for the medical camp also makes
 * them one at the Diwali gate, and keeps them one until somebody remembers to
 * take it back. The same goes for role: whoever runs a station at the camp is not
 * thereby a station volunteer at the dance night.
 *
 * `EventAssignment` closes that gap without displacing `Membership`, which stays
 * the org-level default and the right answer for every screen that is not about
 * one event.
 */
export type EventMember = CurrentMember & {
  eventId: string;
  /**
   * True when an `EventAssignment` row supplied the role and capabilities above,
   * false when they came from the org `Membership`. Worth surfacing so a screen
   * can say "for this event" rather than implying the assignment is permanent.
   */
  fromAssignment: boolean;
};

/**
 * Resolve a member's effective role and capabilities at one event.
 *
 * RESOLUTION ORDER, and it is the whole rule:
 *   1. the `EventAssignment` for (eventId, userId), if one exists;
 *   2. otherwise the org-level `Membership`.
 *
 * An assignment overrides the org role WHOLE — role, `canHoldTill` and
 * `canOverrideWaiver` together, including when a flag is false. That is what
 * makes it possible to stand a standing till holder down for one night without
 * touching their org membership; merging the two per-field (OR-ing the flags)
 * would make the override one-way and that case unexpressible.
 *
 * Returns null for a signed-out visitor or a non-member of the active org, so
 * callers can distinguish "who?" from "not you". `requireEventRole` does the
 * redirecting.
 */
export async function getEventMember(
  eventId: string,
): Promise<EventMember | null> {
  const member = await getCurrentMember();
  if (!member) return null;

  // Scoped to the active org as well as the event: an event id is a cuid a
  // caller supplies, and resolving one belonging to another tenant would leak
  // across the org boundary that `getCurrentMember` just established.
  const assignment = await db.eventAssignment.findFirst({
    where: {
      eventId,
      userId: member.userId,
      event: { orgId: member.orgId },
    },
  });

  if (!assignment) return { ...member, eventId, fromAssignment: false };

  return {
    ...member,
    eventId,
    role: assignment.role,
    canHoldTill: assignment.canHoldTill,
    fromAssignment: true,
  };
}

/**
 * Require one of the given roles AT THIS EVENT (Coordinator always passes).
 * Redirects to /login if unauthenticated and /403 if authenticated but
 * unauthorized — the same contract as `requireRole`, which keeps its org-level
 * semantics and all of its call sites untouched.
 *
 * COORDINATOR IS STILL THE SUPERUSER, but now at two levels: an org coordinator
 * passes everywhere, and an event assignment of COORDINATOR passes at that
 * event. The second is the point — it is how the person actually running one
 * night gets full authority for that night and nothing beyond it.
 */
export async function requireEventRole(
  eventId: string,
  ...roles: Role[]
): Promise<EventMember> {
  const member = await getEventMember(eventId);
  if (!member) redirect("/login");
  if (member.role !== "COORDINATOR" && !roles.includes(member.role)) {
    redirect("/403");
  }
  return member;
}
