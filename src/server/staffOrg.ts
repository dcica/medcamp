import { db } from "@/lib/db";
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
