import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Every lookup a visitor can reach WITHOUT a session goes through here, and
 * every one of them takes the organisation the request resolved to. One
 * deployment serves several organisations, and an id-only `findUnique` on a
 * public page would render — or sell — one tenant's event under another
 * tenant's name and host. There is no row-level security yet; this file and
 * verify-tenant §7/§8 are the boundary.
 *
 * Nothing here reads the request. The page resolves `getActiveOrg()` and
 * passes `org.id`, so the same functions are callable from the verify suite
 * with two scratch organisations and no request at all.
 */

/** The candidate pool for `/register` with no `?event=`: what isRegistrationOpen accepts. */
const openOrWalkIn = (now: Date): Prisma.EventWhereInput => ({
  OR: [
    { status: "OPEN", endsAt: { gte: now } },
    { status: "ACTIVE", walkInOpensAt: { not: null } },
  ],
});

/** An offering a competition entry can attach to. */
const feeOffering = { serviceType: { active: true, kind: "FEE" } } as const;

export function findPublicEvent(orgId: string, id: string) {
  return db.event.findFirst({ where: { id, orgId } });
}

/**
 * Narrows the CANDIDATE POOL to exactly the states isRegistrationOpen accepts;
 * the predicate is still the sole decider on whatever comes back, so drift
 * between the two can only ever produce a false empty state, never a checkout
 * the submit action then refuses. `endsAt` asc picks the next thing happening.
 */
export function findDefaultPublicEvent(orgId: string, now: Date) {
  return db.event.findFirst({
    where: { orgId, ...openOrWalkIn(now) },
    orderBy: { endsAt: "asc" },
  });
}

export function findPerformEvent(orgId: string, id: string) {
  return db.event.findFirst({ where: { id, orgId, caps: { some: feeOffering } } });
}

export function findDefaultPerformEvent(orgId: string, now: Date) {
  return db.event.findFirst({
    where: { orgId, caps: { some: feeOffering }, ...openOrWalkIn(now) },
    orderBy: { endsAt: "asc" },
  });
}

type OrderArgs = Omit<Prisma.OrderFindFirstArgs, "where">;
type AttendeeArgs = Omit<Prisma.AttendeeFindFirstArgs, "where">;

/**
 * An order by id, within the organisation. `args` is the page's own
 * include/select, and the result is typed by it — the cast is what carries
 * the page's shape through Prisma's generic, nothing more.
 */
export function findPublicOrder<T extends OrderArgs>(
  orgId: string,
  id: string,
  args: T,
): Promise<Prisma.OrderGetPayload<T> | null> {
  return db.order.findFirst({ ...args, where: { id, orgId } }) as unknown as Promise<
    Prisma.OrderGetPayload<T> | null
  >;
}

/** A ticket (attendee) by its code, within the organisation. */
export function findTicket<T extends AttendeeArgs>(
  orgId: string,
  campId: string,
  args: T,
): Promise<Prisma.AttendeeGetPayload<T> | null> {
  return db.attendee.findFirst({ ...args, where: { campId, orgId } }) as unknown as Promise<
    Prisma.AttendeeGetPayload<T> | null
  >;
}
