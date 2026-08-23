/**
 * What a coordinator has to DO about one group's track — the SINGLE derivation.
 *
 * This file exists because the roster used to answer that question twice, in two
 * places, with two different rules. The summary tile counted `songReadyAt ===
 * null` and called the result "Music outstanding"; the card badge branched over
 * songReadyAt → songObjectPath → songDelivery and printed one of four labels. So
 * a roster of three groups — one offline, one whose file had arrived but nobody
 * had listened to, one confirmed — reported "Music outstanding: 2" above two
 * cards reading "Offline — needs contact" and "File received". Nothing on the
 * page said which of those two was the 2, and "File received" reads as done.
 *
 * The four states are four different jobs, and collapsing them hides which one
 * is owed:
 *
 *   OFFLINE          the group said they would send the track another way.
 *                    Needs a phone call.
 *   AWAITING_UPLOAD  they chose to upload and no file has arrived.
 *                    Needs a reminder email — the entry page is still open to them.
 *   RECEIVED         a file is in the bucket and no human has played it.
 *                    Needs a coordinator to actually listen to it.
 *   CONFIRMED        a playable, prepared cut is in hand. Done.
 *
 * Deliberately dependency-free (no Prisma, no db) so the client roster, the
 * server summary, the CSV export and the verify script all read the same code.
 * Importing this from `@/server/performance` instead would drag the database
 * client into a "use client" bundle.
 */

export type MusicState = "OFFLINE" | "AWAITING_UPLOAD" | "RECEIVED" | "CONFIRMED";

/** Chip order: the work first, done last. */
export const MUSIC_STATES = [
  "OFFLINE",
  "AWAITING_UPLOAD",
  "RECEIVED",
  "CONFIRMED",
] as const;

/** The facts a music state is derived from. Structural, so both the DB row and the roster DTO satisfy it. */
export type MusicFacts = {
  songDelivery: "UPLOAD" | "OFFLINE";
  hasSongFile: boolean;
  songReadyAt: Date | null;
};

/**
 * Precedence is load-bearing:
 *
 *  - songReadyAt WINS over everything. A coordinator who was handed a USB stick
 *    at practice marks the entry ready while delivery is still OFFLINE and no
 *    object exists; that entry is done and must not sit on the chase list.
 *  - a file present beats OFFLINE. completeSongUpload flips delivery to UPLOAD,
 *    so the combination should not occur — but if it ever does, something
 *    arrived and the right next step is to listen to it, not to phone them.
 */
export function musicState(entry: MusicFacts): MusicState {
  if (entry.songReadyAt !== null) return "CONFIRMED";
  if (entry.hasSongFile) return "RECEIVED";
  return entry.songDelivery === "OFFLINE" ? "OFFLINE" : "AWAITING_UPLOAD";
}

/** Anything a coordinator still owes work on. The ONLY definition of the word. */
export function isMusicOutstanding(entry: MusicFacts): boolean {
  return musicState(entry) !== "CONFIRMED";
}

/** Filter-chip wording — names the ACTION, because that is what the chip selects. */
export const MUSIC_FILTER_LABEL: Record<MusicState, string> = {
  OFFLINE: "Needs chasing (offline)",
  AWAITING_UPLOAD: "Not sent yet",
  RECEIVED: "Received, unchecked",
  CONFIRMED: "Confirmed",
};

/** Badge wording on a card, where the group name already supplies the subject. */
export const MUSIC_BADGE_LABEL: Record<MusicState, string> = {
  OFFLINE: "Offline — needs contact",
  AWAITING_UPLOAD: "No file yet",
  RECEIVED: "File received",
  CONFIRMED: "Track ready",
};

/** Stable, lowercase token for CSV and query strings. */
export const MUSIC_SLUG: Record<MusicState, string> = {
  OFFLINE: "offline",
  AWAITING_UPLOAD: "not-sent",
  RECEIVED: "received",
  CONFIRMED: "confirmed",
};

/** Parse a `?music=` value back to a state. Unknown / absent → null (= all). */
export function musicStateFromSlug(value: string | null | undefined): MusicState | null {
  if (!value) return null;
  return MUSIC_STATES.find((s) => MUSIC_SLUG[s] === value) ?? null;
}
