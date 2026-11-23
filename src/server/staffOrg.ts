import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeHost } from "@/lib/tenantResolve";
import { tenantLookup } from "@/lib/tenant";

/**
 * Which organisation a signed-in staff member works in.
 *
 * The NextAuth session cookie is host-only and the tenant domains share no
 * parent, so staff sign in on the PLATFORM host and the organisation they
 * work in has to be chosen there: from the tenant host they were sent over
 * from (/staff/from), from their memberships (/staff/org, /api/org/select),
 * or from a pending invite in any organisation (first sign-in). The choice is
 * remembered in the `medcamp_org` cookie, which src/lib/tenant.ts reads on
 * the platform host and the middleware turns into a /o/<slug> path.
 *
 * Nothing here reads the request, so verify-tenant can exercise every rule
 * with two scratch organisations.
 */

export const ORG_COOKIE_MAX_AGE = 30 * 24 * 3600;

export function orgCookieOptions(secure: boolean) {
  return { path: "/", sameSite: "lax" as const, secure, maxAge: ORG_COOKIE_MAX_AGE };
}

/**
 * A `then` query parameter that is safe to redirect to: a same-origin path.
 * Anything else — an absolute URL, a protocol-relative one, nothing at all —
 * goes to the staff landing page, which resolves a destination from the role.
 */
export function safeThenPath(then: string | null | undefined): string {
  if (!then || !then.startsWith("/") || then.startsWith("//") || then.startsWith("/\\")) {
    return "/staff";
  }
  return then;
}

/** The organisation `slug`, if `userId` holds a membership in it; otherwise null. */
export async function selectOrgForUser(userId: string, slug: string) {
  const membership = await db.membership.findFirst({
    where: { userId, org: { slug } },
    include: { org: { include: { domains: true } } },
  });
  return membership?.org ?? null;
}

/** Every organisation the user belongs to, for the switcher. */
export function listMemberships(userId: string) {
  return db.membership.findMany({
    where: { userId },
    include: { org: true },
    orderBy: { org: { name: "asc" } },
  });
}

/** The organisation behind a tenant hostname (the `host` /staff/from was sent from). */
export async function orgForHost(host: string | null | undefined) {
  const hostname = normalizeHost(host);
  return hostname ? tenantLookup.byHost(hostname) : null;
}

/**
 * Accept every pending invite for an address, in every organisation. Called on
 * a sign-in that resolved no organisation (the platform host), where the old
 * single-org grant had nothing to grant into. Returns how many memberships
 * were created; an invite whose membership already exists is just closed.
 */
export async function acceptPendingInvites(userId: string, email: string): Promise<number> {
  const pending = await db.invite.findMany({
    where: { email: email.toLowerCase(), acceptedAt: null },
  });
  let accepted = 0;
  for (const invite of pending) {
    const existing = await db.membership.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
    });
    await db.$transaction([
      ...(existing
        ? []
        : [
            db.membership.create({
              data: {
                orgId: invite.orgId,
                userId,
                role: invite.role,
                canHoldTill: invite.canHoldTill,
                canOverrideWaiver: invite.canOverrideWaiver,
              },
            }),
          ]),
      db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    ]);
    if (!existing) accepted += 1;
  }
  return accepted;
}

/**
 * Everything a sign-in may grant, in order, idempotently:
 *   1. every pending invite for the address, in EVERY organisation — first,
 *      whatever organisation the request resolved to, because an existing
 *      member invited to a second organisation signs in with the first one's
 *      staff cookie and would otherwise never receive the second;
 *   2. on the resolved organisation only, a BOOTSTRAP_ADMIN_EMAILS address
 *      with no membership yet becomes its COORDINATOR.
 * Returns how many memberships were created. The auth sign-in event calls
 * this and nothing else; the suite calls it directly, resolved or not.
 */
export async function grantOnSignIn(
  userId: string,
  email: string,
  org: { id: string } | null,
): Promise<number> {
  const address = email.toLowerCase();
  let created = await acceptPendingInvites(userId, address);
  if (!org) return created;
  const existing = await db.membership.findUnique({
    where: { orgId_userId: { orgId: org.id, userId } },
  });
  if (existing) return created;
  const admins = (env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(address)) {
    await db.membership.create({
      data: { orgId: org.id, userId, role: "COORDINATOR", canHoldTill: true },
    });
    created += 1;
  }
  return created;
}
