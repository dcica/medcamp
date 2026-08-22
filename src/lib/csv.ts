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
 * Existing routes are left as they are; this is used by new ones.
 */

/** RFC 4180: quote a field containing a comma, quote or newline; double the quotes. */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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
