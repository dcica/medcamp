import { PrismaClient } from "@prisma/client";
import type { Event } from "@prisma/client";

/**
 * The client is built by a factory so its type can be DERIVED rather than
 * declared. `omit` below narrows the model result types, so the constructed
 * client is not a bare `PrismaClient` any more and annotating the hot-reload
 * cache as one would silently widen it back — putting `internalNotes` into
 * every event type while the runtime kept withholding it.
 */
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],

    /**
     * Fields that must be asked for by name, because the default is not to read
     * them at all.
     *
     * `Event.internalNotes` is coordinator-only working text — load-in times,
     * the sound desk's number, who has the venue key. WHY IT IS OMITTED
     * GLOBALLY rather than left out of the handful of queries that could leak
     * it: EVENT ROWS SURVIVE THE PURGE. `purgedAt` erases attendee PII and
     * leaves the event standing indefinitely, so anything written in this box
     * outlives the deletion that is supposed to remove it. A field with that
     * property should not be one `select` away from a public page.
     *
     * The public listings (src/app/page.tsx, src/app/events/page.tsx) already
     * read whole event rows with no `select`. Nothing leaks today — both are
     * server components and neither hands a whole row across a client boundary
     * — but the guarantee rested entirely on that staying true, and on every
     * future `db.event.findMany` being written by someone who knew. Omitting
     * per-query would have protected exactly the two call sites we happened to
     * notice; the next one would start unprotected again.
     *
     * DEFAULT-SAFE, OPT-IN TO EXPOSE. The one screen that legitimately edits
     * this field asks for it back with `omit: { internalNotes: false }` — a
     * deliberate line of code, visible in review, at the single place it is
     * wanted. Writes are unaffected: `omit` governs what comes back, not what
     * goes in, so updateCamp still saves it.
     */
    omit: {
      event: { internalNotes: true },
    },
  });
}

// Reuse the client across hot reloads in dev to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * An event row AS THE APP ACTUALLY READS IT: every column except the omitted
 * `internalNotes`.
 *
 * Use this, not Prisma's `Event`, to annotate anything holding the result of an
 * event query. `Event` describes the table, and since the omission the two are
 * no longer the same shape — a function declaring `Promise<Event>` claims to
 * return a field the client does not hand it. The screen that opts back in with
 * `omit: { internalNotes: false }` gets the full `Event` and should say so.
 */
export type EventRecord = Omit<Event, "internalNotes">;
