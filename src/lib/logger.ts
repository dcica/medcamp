/**
 * Minimal structured logger. Emits ONE JSON object per line — single-line by
 * construction, because JSON.stringify escapes any newlines inside values
 * (e.g. an email body or a stack trace). Single-line logs stay greppable and
 * render correctly in the Vercel / CloudWatch log viewers, which split on
 * newlines and would otherwise show one event as many broken entries.
 *
 *   log.info("order confirmed", { orderId, method });
 *   log.error("email send failed", { to, err });   // err can be an Error
 *
 * Level threshold comes from LOG_LEVEL (debug | info | warn | error); defaults
 * to "debug" in dev and "info" otherwise. Reads process.env directly (NOT
 * lib/env) to avoid a circular import — lib/env logs during its own validation.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in WEIGHT) return WEIGHT[raw as LogLevel];
  return process.env.NODE_ENV === "production" ? WEIGHT.info : WEIGHT.debug;
}

export type LogFields = Record<string, unknown>;

/** Expand Error values into plain objects so they serialize usefully. */
function normalize(fields?: LogFields): LogFields {
  if (!fields) return {};
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] =
      v instanceof Error ? { name: v.name, message: v.message } : v;
  }
  return out;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (WEIGHT[level] < threshold()) return;
  const record = {
    level,
    t: new Date().toISOString(),
    msg,
    ...normalize(fields),
  };
  // JSON.stringify guarantees a single physical line.
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // AND, for the two levels worth keeping, a row in the database.
  //
  // Vercel retains runtime logs for roughly two hours on this plan. An event
  // ends at 10pm and the first "what happened at the gate?" arrives the next
  // morning, by which time stdout is the only record and it is gone.
  //
  // FIRE AND FORGET, and `emit` stays synchronous. Every caller is a request
  // handler, a webhook or a transaction, and none of them should wait on — or
  // be able to fail because of — a log write.
  //
  // The import is DYNAMIC and inside the sink, not at the top of this file:
  // src/middleware.ts runs on the edge runtime and this module is imported
  // widely, so a static Prisma import would pull the client into that bundle.
  // It also keeps logger.ts dependency-free at module scope, which is the
  // property that let it be imported from lib/env during env validation.
  if (level === "error" || level === "warn") {
    void persistQuietly(level, msg, fields);
  }
}

/** Never throws, never awaited, never logs about itself. */
async function persistQuietly(
  level: "warn" | "error",
  msg: string,
  fields?: LogFields,
): Promise<void> {
  try {
    const { persistLogEntry } = await import("@/lib/errorSink");
    await persistLogEntry({ level, message: msg, fields });
  } catch {
    // Deliberately silent. Logging a logging failure is the recursion the sink
    // is shaped to avoid; stdout above already has the original line.
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
