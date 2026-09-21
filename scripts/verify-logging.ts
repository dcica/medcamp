/**
 * Error-persistence regression check — the log that outlives the platform's.
 *
 *   npx tsx scripts/verify-logging.ts
 *
 * WHY THIS EXISTS, in the reporter's words: "all errors shoudl be saved in the
 * db. vercel only saves 2 hours of logs." An event ends at 10pm and the first
 * "what happened at the gate?" arrives the next morning, by which time stdout
 * is the only record and it is gone.
 *
 * WHAT IT PINS. Every hazard here is on the ERROR PATH, which is the one place
 * a bug is hardest to notice — it only misbehaves when something else has
 * already gone wrong:
 *
 *   1. the sink must never throw (the DB is most likely down exactly when
 *      errors are being logged);
 *   2. it must never recurse (a failed write that logs about itself is an
 *      infinite loop);
 *   3. it must never block a request;
 *   4. it must never carry a secret into a table that outlives the request.
 *
 * Uses the local database and cleans up after itself.
 */
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();
const MARK = "verify-logging-probe";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Drop // and block comments, so a rule can be stated in prose and enforced. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main(): Promise<void> {
  const scrub = await import("../src/lib/errorScrub");
  const sink = await import("../src/lib/errorSink");

  await db.errorLog.deleteMany({ where: { message: { contains: MARK } } });

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§1 nothing secret reaches the table");
  // `log.error("email send failed", { to, err })` already puts real values in
  // here. Persisting changes their lifetime from two hours to thirty days, so
  // the shape is narrowed on the way in rather than trusted.
  for (const key of [
    "token", "accessToken", "STRIPE_SECRET_KEY", "apiKey", "password",
    "authorization", "x-signature", "cookie", "sessionId", "credentials", "otp",
  ]) {
    check(`${key} is a denied key`, scrub.isDeniedKey(key));
  }
  for (const key of ["orderId", "campId", "eventName", "count", "to"]) {
    check(`${key} is NOT denied`, !scrub.isDeniedKey(key));
  }

  const scrubbed = scrub.scrubFields({
    orderId: "abc",
    stripeSecretKey: "sk_live_realmoney",
    authorization: "Bearer xyz",
  });
  eq("a denied value is replaced, not dropped", scrubbed?.stripeSecretKey, scrub.REDACTED);
  eq("...so the field is still visibly present", "stripeSecretKey" in (scrubbed ?? {}), true);
  eq("an innocuous value survives intact", scrubbed?.orderId, "abc");

  const long = scrub.scrubFields({ blob: "x".repeat(50_000) });
  check("a huge value is truncated",
    String(long?.blob).length < scrub.MAX_VALUE_CHARS + 50,
    String(String(long?.blob).length));

  // Cyclic structures are entirely possible on an error path and must not be
  // the thing that stops an error being recorded.
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;
  const cyclicOut = scrub.scrubFields({ cyclic });
  check("a cyclic value does not throw", cyclicOut !== null);
  eq("...it is recorded as unserializable", cyclicOut?.cyclic, "[unserializable]");

  const many: Record<string, unknown> = {};
  for (let i = 0; i < 200; i++) many[`f${i}`] = i;
  const capped = scrub.scrubFields(many);
  check("a huge field count is capped",
    Object.keys(capped ?? {}).length <= scrub.MAX_FIELDS + 1,
    String(Object.keys(capped ?? {}).length));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§2 repeats group, so one loop cannot bury everything else");
  const fp = scrub.fingerprintFor("error", "boom", "TypeError");
  eq("the same failure fingerprints the same", scrub.fingerprintFor("error", "boom", "TypeError"), fp);
  check("a different message differs", scrub.fingerprintFor("error", "bang", "TypeError") !== fp);
  check("a different level differs", scrub.fingerprintFor("warn", "boom", "TypeError") !== fp);
  check("a different error type differs", scrub.fingerprintFor("error", "boom", "RangeError") !== fp);
  // NOT the stack and NOT the fields: both vary per occurrence (a line number
  // moves, an orderId differs every time), and a key that changes every time
  // groups nothing at all.
  const srcScrub = readFileSync(join(process.cwd(), "src/lib/errorScrub.ts"), "utf8");
  const body = srcScrub.slice(srcScrub.indexOf("export function fingerprintFor"));
  check("the fingerprint ignores the stack", !body.includes("stack"));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3 a write actually lands, scrubbed");
  sink.resetFloodControl();
  await sink.persistLogEntry({
    level: "error",
    message: `${MARK} landed`,
    fields: { orderId: "ord_1", apiKey: "sk_live_nope", err: new TypeError("kaboom") },
    route: "/scan",
  });
  const row = await db.errorLog.findFirst({ where: { message: `${MARK} landed` } });
  check("the row exists", row !== null);
  eq("the level is recorded", row?.level, "error");
  eq("the error type is recorded", row?.errorName, "TypeError");
  eq("the error message is recorded", row?.errorMessage, "kaboom");
  check("a stack is captured", (row?.stack ?? "").length > 0);
  eq("the route is recorded", row?.route, "/scan");
  const stored = (row?.fields ?? {}) as Record<string, unknown>;
  eq("THE SECRET IS NOT IN THE TABLE", stored.apiKey, scrub.REDACTED);
  eq("...but the useful field is", stored.orderId, "ord_1");
  check("the raw secret appears nowhere in the row",
    !JSON.stringify(row).includes("sk_live_nope"));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§4 the sink cannot take the app down with it");
  // THE ROWS THIS FILE EXISTS FOR. The database is most likely to be
  // unreachable at exactly the moment errors are being logged.
  const srcSink = readFileSync(join(process.cwd(), "src/lib/errorSink.ts"), "utf8");
  const srcLogger = readFileSync(join(process.cwd(), "src/lib/logger.ts"), "utf8");
  const sinkCode = stripComments(srcSink);

  check("the sink swallows its own failures", /catch\s*\{/.test(srcSink));
  // If a failed write logged about itself, that log would try to write, fail,
  // log... The guard and the silence are both load-bearing.
  check("the sink never calls the logger", !/\blog\.(error|warn|info|debug)\(/.test(srcSink));
  // Structural but shape-based, not a name match: renaming the flag is not a
  // regression, REMOVING it is. Wants both halves -- an early return before
  // the write, and a reset in a finally so one failed write cannot wedge the
  // sink shut for the life of the instance.
  const sinkBody = sinkCode.slice(sinkCode.indexOf("persistLogEntry"));
  check("the sink refuses to re-enter itself",
    /if\s*\(\s*\w+\s*\)\s*return;/.test(sinkBody));
  check("...and always releases the guard afterwards",
    /finally\s*\{[\s\S]{0,120}=\s*false;/.test(sinkBody));
  check("the logger does not await the write", srcLogger.includes("void persistQuietly"));
  check("the logger's own reporting path is silent too",
    !/persistQuietly[\s\S]*?log\.(error|warn)\(/.test(srcLogger));
  // src/middleware.ts runs on the EDGE runtime and imports nothing that may
  // drag Prisma in. logger.ts is imported widely, so its DB reach must be a
  // dynamic import resolved at call time.
  check("the sink is imported dynamically, never at module scope",
    srcLogger.includes('await import("@/lib/errorSink")') &&
      !/^import .*errorSink/m.test(srcLogger));
  check("the sink reaches the database dynamically too",
    srcSink.includes('await import("@/lib/db")') && !/^import .*lib\/db/m.test(srcSink));

  // Proven, not just read: a sink pointed at a broken client must resolve.
  let threw = false;
  try {
    await sink.persistLogEntry({
      level: "error",
      message: `${MARK} ${"y".repeat(5000)}`,
      fields: { huge: "z".repeat(200_000) },
    });
  } catch {
    threw = true;
  }
  check("an oversized entry does not throw", !threw);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§5 one hot loop cannot fill the table");
  sink.resetFloodControl();
  for (let i = 0; i < 100; i++) {
    await sink.persistLogEntry({ level: "error", message: `${MARK} flood` });
  }
  const flooded = await db.errorLog.count({ where: { message: `${MARK} flood` } });
  check("a flood is capped well below its attempt count", flooded < 100, `${flooded} rows`);
  check("...but it is not silenced entirely", flooded > 0, `${flooded} rows`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§6 the table is bounded, and swept with model operations");
  check("retention is a stated number of days", sink.ERROR_LOG_RETENTION_DAYS > 0);
  check("there is a hard row ceiling as well", sink.ERROR_LOG_MAX_ROWS > 0);
  // Never $executeRaw: an unqualified table name resolves through the pooled
  // session's search_path, which Supabase does not reliably set from the
  // connection string. That is the rule a silently-reverted PAID ORDER
  // established, and a sweep is exactly the kind of code that invites raw SQL.
  // sinkCode is comment-stripped (hoisted in §4): errorSink's own prose NAMES
  // the forbidden calls to explain why they are forbidden, and that explanation
  // is worth more than a grep that is simpler to write.
  check("the sweep uses Prisma model operations, never raw SQL",
    !sinkCode.includes("$executeRaw") && !sinkCode.includes("$queryRaw"));

  const old = await db.errorLog.create({
    data: {
      level: "error", message: `${MARK} ancient`, fingerprint: "deadbeef",
      createdAt: new Date(Date.now() - (sink.ERROR_LOG_RETENTION_DAYS + 5) * 86_400_000),
    },
  });
  const swept = await sink.sweepErrorLog();
  check("the sweep deletes something", swept.deleted > 0, String(swept.deleted));
  eq("an expired row is gone",
    await db.errorLog.findUnique({ where: { id: old.id } }), null);
  check("a fresh row survives the sweep",
    (await db.errorLog.findFirst({ where: { message: `${MARK} landed` } })) !== null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§7 the table is not write-only");
  // A write-only table is worse than none: it costs storage, holds real data,
  // and nobody ever finds out whether it works.
  const adminPage = readFileSync(join(process.cwd(), "src/app/admin/errors/page.tsx"), "utf8");
  check("there is a page that reads it", adminPage.includes("errorLog"));
  check("...grouped rather than an endless list", adminPage.includes("groupBy"));
  check("...and coordinator-only, since rows carry stacks and names",
    adminPage.includes("requireCoordinator"));
  const nav = readFileSync(join(process.cwd(), "src/app/_components/staffNav.ts"), "utf8");
  check("...and it is reachable from the menu", nav.includes('href: "/admin/errors"'));
  // No boundary existed anywhere before this: a render that threw showed the
  // stock Next.js page and left no record at all.
  for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    check(`${f} reports itself`, src.includes("/api/client-error"));
    check(`${f} survives the reporter failing`, src.includes("catch"));
  }

  await db.errorLog.deleteMany({ where: { message: { contains: MARK } } });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.errorLog.deleteMany({ where: { message: { contains: MARK } } });
    await db.$disconnect();
  });
