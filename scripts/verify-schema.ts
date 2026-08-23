/**
 * Schema invariants that no screen and no test would ever notice.
 *
 *   npx tsx scripts/verify-schema.ts
 *
 * PURE. Reads `prisma/schema.prisma` off disk as TEXT and asserts properties of
 * the declaration itself — no database, no network, no Prisma client. That is
 * the same technique scripts/verify-branding.ts uses, and it is chosen for the
 * same reason: the property being checked is a property of the SOURCE, so
 * checking it against a live database would only prove that somebody remembered
 * to migrate, not that the next person will.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `20260822120000_index_foreign_keys` established the rule that every foreign
 * key's child column carries a covering index, and fixed thirteen violations.
 * Within the same week a fourteenth appeared — `events.flagsReviewedById`, added
 * on a branch developed in parallel and merged after the sweep, on an
 * `ON DELETE SET NULL` edge, which is the worst case the sweep's own rationale
 * calls out: deleting a user must find every row naming them in order to null
 * the column, and with no index it does that with a sequential scan while
 * holding the parent row lock.
 *
 * That reintroduction was caught by a human reading a handoff document. There
 * was no automated check, so there was nothing to catch it. This is that check.
 *
 * ── WHAT "COVERING" MEANS HERE ──────────────────────────────────────────────
 *
 * A B-tree index on (a, b) can serve a lookup on (a), and on (a, b), but NOT on
 * (b) alone — the leading column has to match. So an FK on [x] is covered by any
 * index whose FIRST column is x, and an FK on [a, b] by any index whose first two
 * columns are a, b in that order. A prefix test, not a set test. Using a set test
 * would pass an FK on [b] against `@@index([a, b])`, which Postgres cannot use.
 *
 * Indexes come from four places, and all four count because Prisma emits a real
 * index for each: `@@index`, `@@unique`, `@@id`, and the single-field `@id` /
 * `@unique` attributes on a field line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = join(process.cwd(), "prisma", "schema.prisma");

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

type Model = {
  name: string;
  /** Every FK declared on this model: the child column list, in order. */
  foreignKeys: { fields: string[]; line: string }[];
  /** Every index this model gets, as an ordered column list. */
  indexes: string[][];
};

/** `[a, b]` → `["a","b"]`. Tolerates `@@index([a(sort: Desc)])`. */
function columnList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\(.*$/, "").trim())
    .filter(Boolean);
}

/**
 * Parse the model blocks. Deliberately line-oriented and dumb: a real Prisma
 * parser is a dependency, and the shapes this file cares about are all on one
 * line in this schema. `assertParserSane` below is what stops that assumption
 * from failing silently if it ever stops being true.
 */
function parseModels(src: string): Model[] {
  const models: Model[] = [];
  let current: Model | null = null;

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("//")) continue; // covers `///` doc comments too

    const open = /^model\s+(\w+)\s*\{/.exec(line);
    if (open) {
      current = { name: open[1], foreignKeys: [], indexes: [] };
      continue;
    }
    if (!current) continue;
    if (line === "}") {
      models.push(current);
      current = null;
      continue;
    }

    // A relation field. `fields:` is absent on the PARENT side of the relation
    // (the back-reference), which owns no column and needs no index.
    if (line.includes("@relation(")) {
      const f = /fields:\s*\[([^\]]*)\]/.exec(line);
      if (f) current.foreignKeys.push({ fields: columnList(f[1]), line });
    }

    const block = /^@@(index|unique|id)\(\s*\[([^\]]*)\]/.exec(line);
    if (block) {
      current.indexes.push(columnList(block[2]));
      continue;
    }

    // Single-field `@id` / `@unique` on a field line — each emits its own index.
    // Excludes `@@`-prefixed lines, already handled above.
    const field = /^(\w+)\s+\S+/.exec(line);
    if (field && !line.startsWith("@@")) {
      if (/@id\b/.test(line) || /@unique\b/.test(line)) {
        current.indexes.push([field[1]]);
      }
    }
  }
  return models;
}

/** True when some index's leading columns are exactly `fk`, in order. */
function isCovered(fk: string[], indexes: string[][]): boolean {
  return indexes.some(
    (idx) => idx.length >= fk.length && fk.every((col, i) => idx[i] === col),
  );
}

function main() {
  const src = readFileSync(SCHEMA, "utf8");
  const models = parseModels(src);

  console.log("\n§1 the parser actually parsed something");
  // THE LOAD-BEARING ASSERTIONS. Without these, a regex that stops matching
  // turns §2 into "no foreign keys found, therefore no violations" and the whole
  // file silently becomes a no-op that reports success forever. The floors are
  // set well under the current counts so ordinary schema growth never trips
  // them, but a parser that breaks outright cannot slip past.
  check("model blocks were found", models.length >= 20, `${models.length} models`);
  const fkCount = models.reduce((n, m) => n + m.foreignKeys.length, 0);
  check("foreign keys were found", fkCount >= 40, `${fkCount} FKs`);
  const idxCount = models.reduce((n, m) => n + m.indexes.length, 0);
  check("indexes were found", idxCount >= 40, `${idxCount} indexes`);
  check(
    "the model this check was written for is present",
    models.some((m) => m.name === "Event"),
    "Event",
  );

  console.log("\n§2 every foreign key's child column has a covering index");
  // One assertion per FK rather than a single "no violations" line: a failure
  // has to name the column, or the next person gets a red check and a schema
  // file to search by hand.
  const violations: string[] = [];
  for (const model of models) {
    for (const fk of model.foreignKeys) {
      const label = `${model.name}.${fk.fields.join("+")}`;
      const ok = isCovered(fk.fields, model.indexes);
      if (!ok) violations.push(label);
      check(label, ok, ok ? "" : "no index leads with this column");
    }
  }

  console.log("\n§3 the rule, stated once");
  check(
    "no unindexed foreign key anywhere in the schema",
    violations.length === 0,
    violations.length ? violations.join(", ") : `${fkCount} checked`,
  );

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
