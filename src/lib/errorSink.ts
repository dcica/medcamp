import {
  extractError,
  fingerprintFor,
  scrubFields,
  type MAX_FIELDS,
} from "@/lib/errorScrub";

/**
 * Persist an error so it is still readable tomorrow.
 *
 * Four hazards shape every line of this file, and all four are on the error
 * path — the one place a bug is hardest to see.
 *
 * 1. IT MUST NOT BLOCK. `log.error` is synchronous and called from request
 *    handlers, webhooks and transactions. This is fire-and-forget: the caller
 *    gets nothing back and waits for nothing.
 *
 * 2. IT MUST NOT THROW. The database is most likely to be unreachable at
 *    exactly the moment errors are being logged. Every path here swallows.
 *
 * 3. IT MUST NOT RECURSE. If the write fails and we log about it, that log
 *    tries to write, fails, logs… The `writing` guard below is what stops it,
 *    and nothing in this module ever calls `log`.
 *
 * 4. IT MUST NOT REACH THE EDGE. src/middleware.ts runs on the edge runtime,
 *    and logger.ts is imported widely. A STATIC `import { db }` here would pull
 *    Prisma into that bundle. The import is dynamic and inside the async body,
 *    so it is only resolved the first time an error is actually persisted.
 */

/** Re-entrancy guard — see hazard 3. */
let writing = false;

/**
 * Per-fingerprint flood control.
 *
 * A hot loop erroring on every request would otherwise fill the table with one
 * message. In-memory and therefore per-instance, which on serverless means it
 * is approximate — that is fine. It is a cheap ceiling, not a quota; the
 * retention sweep is what actually bounds the table.
 */
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_MAX_PER_WINDOW = 20;
const seen = new Map<string, { count: number; since: number }>();

function floodedOut(fingerprint: string, now: number): boolean {
  const entry = seen.get(fingerprint);
  if (!entry || now - entry.since > FLOOD_WINDOW_MS) {
    seen.set(fingerprint, { count: 1, since: now });
    return false;
  }
  entry.count++;
  // Let exactly one line through at the threshold, so the table records that
  // the flood happened rather than simply going quiet.
  return entry.count > FLOOD_MAX_PER_WINDOW;
}

/** How long a row is kept. Long enough for "what happened last night". */
export const ERROR_LOG_RETENTION_DAYS = 30;
/** Hard ceiling, so a bad night cannot fill a free-tier database. */
export const ERROR_LOG_MAX_ROWS = 5_000;

export type SinkInput = {
  level: "warn" | "error";
  message: string;
  fields?: Record<string, unknown>;
  orgId?: string | null;
  route?: string | null;
};

/**
 * Write one row. Returns nothing and never rejects.
 *
 * Exported for the verify suite, which calls it directly; application code
 * reaches it through `log.error` / `log.warn`.
 */
export async function persistLogEntry(input: SinkInput): Promise<void> {
  if (writing) return;
  const err = extractError(input.fields);
  const fingerprint = fingerprintFor(input.level, input.message, err.name);
  if (floodedOut(fingerprint, Date.now())) return;

  writing = true;
  try {
    // Dynamic — hazard 4. Also keeps a cold start from paying for Prisma until
    // something actually goes wrong.
    const { db } = await import("@/lib/db");
    await db.errorLog.create({
      data: {
        level: input.level,
        message: input.message.slice(0, 500),
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
        // Prisma's Json column rejects `undefined`; null is the empty value.
        fields: (scrubFields(input.fields) ?? undefined) as never,
        orgId: input.orgId ?? null,
        route: input.route ?? null,
        fingerprint,
      },
    });
  } catch {
    // Swallowed on purpose — hazards 2 and 3. There is deliberately no
    // log.error here: that is the recursion this whole file is shaped around.
  } finally {
    writing = false;
  }
}

/**
 * Trim the table. Age first, then a hard row ceiling.
 *
 * Model operations only, never raw SQL — `$executeRaw` with an unqualified
 * table name resolves through the pooled session's search_path, which Supabase
 * does not reliably set from the connection string. That is the rule a silently
 * reverted paid order established, and it applies here too.
 */
export async function sweepErrorLog(): Promise<{ deleted: number }> {
  const { db } = await import("@/lib/db");
  const cutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * 86_400_000);
  const byAge = await db.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } });

  let deleted = byAge.count;
  const remaining = await db.errorLog.count();
  if (remaining > ERROR_LOG_MAX_ROWS) {
    const oldest = await db.errorLog.findMany({
      orderBy: { createdAt: "asc" },
      take: remaining - ERROR_LOG_MAX_ROWS,
      select: { id: true },
    });
    const byCount = await db.errorLog.deleteMany({
      where: { id: { in: oldest.map((r) => r.id) } },
    });
    deleted += byCount.count;
  }
  return { deleted };
}

/** Test seam: the flood window forgets between suite sections. */
export function resetFloodControl(): void {
  seen.clear();
}

export type { MAX_FIELDS };
