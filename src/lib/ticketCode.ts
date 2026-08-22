/**
 * What a volunteer typing at a door actually means by the characters they type.
 *
 * One door is staffed for one event, so the gate shows the event prefix as fixed
 * text and the volunteer types only the trailing token — re-typing `GB-2026W-`
 * for every manual lookup is 8 characters of transcription risk per ticket with
 * a queue waiting.
 *
 * A value that ALREADY contains a hyphen is passed through whole. Tokens never
 * contain one (Crockford base32, see src/lib/publicId.ts), so its presence is an
 * unambiguous signal that the operator holds a complete id rather than a token —
 * a pasted code, a scan re-typed by hand, or the case that genuinely happens at
 * a door: someone arrives at the Dandiya gate holding a Garba ticket. Blindly
 * prefixing that would report "no match", when what staff need to see is the
 * ticket resolving against the WRONG EVENT so they can say so.
 *
 * Lives here rather than inside `ManualEntry` because it is a rule, not a
 * layout: the gate screen is being redesigned around it, and the rule has to
 * survive every element on that screen moving.
 */
export function expandTicketCode(eventCode: string, typed: string): string | null {
  const value = typed.trim().toUpperCase();
  if (!value) return null;
  return value.includes("-") ? value : `${eventCode}-${value}`;
}
