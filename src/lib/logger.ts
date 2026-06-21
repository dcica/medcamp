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
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
