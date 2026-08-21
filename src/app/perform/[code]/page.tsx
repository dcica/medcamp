import Link from "next/link";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rateLimit";
import { getEntryByCode } from "@/server/performance";
import { uploadsEnabled, SONG_MAX_BYTES } from "@/lib/storage";
import { CONTACT_EMAIL } from "@/lib/contact";
import { PageHelp } from "@/app/_components/PageHelp";
import { SongDelivery } from "./SongDelivery";

export const dynamic = "force-dynamic";

/**
 * Entry status + song delivery, reached by the receipt code on the confirmation
 * email — `/perform/GARBA-2026-K7M2XQ9T`.
 *
 * The code IS the authorization: there is no login anywhere in this flow, and a
 * choreographer comes back days later from a different phone. It is an opaque
 * 40-bit CSPRNG token (src/lib/publicId.ts), and getEntryByCode returns null for
 * an unpaid order exactly as it does for a bad code — so a cancelled checkout is
 * indistinguishable from a wrong guess and cannot reach an upload slot it never
 * paid for.
 */
export default async function PerformEntryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  // Rate limit the LOOKUP too, not just the mutating actions: this page is the
  // cheapest oracle on the site otherwise, and the actions behind it are only
  // reachable once you already hold a valid code.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = !rateLimit(`perform-lookup:${ip}`, 30, 600).ok;

  const entry = limited ? null : await getEntryByCode(code);

  if (limited) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">Too many attempts</h1>
        <p className="mt-2 text-sm text-gray-600">
          Wait a few minutes and open the link from your confirmation email
          again.
        </p>
      </main>
    );
  }

  if (!entry) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-8">
        <h1 className="text-xl font-bold">Entry not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          That code doesn&apos;t match a paid entry. Check the link in your
          confirmation email — the code looks like{" "}
          <span className="font-mono">RON-2026-K7M2XQ9T</span>. If you completed
          payment and still see this, write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-6">
          <Link href="/events" className="text-sm text-brand underline">
            ← Back to events
          </Link>
        </p>
      </main>
    );
  }

  const maxMb = Math.round(SONG_MAX_BYTES / (1024 * 1024));

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-6">
      <PageHelp
        id="perform-entry"
        title="Your entry"
        subtitle={entry.eventName}
        items={[
          {
            label: "You're entered",
            body: "Your fee is paid and your group has a slot. Keep this link — it's how you send us your music and check your details.",
          },
          {
            label: "Send your track",
            body: `Upload an MP3 up to ${maxMb} MB. If your file is a different format or too big, choose to send it to the organizers instead and we'll contact you.`,
          },
          {
            label: "Changes",
            body: "Need to correct a group name, size, or song? Reply to your confirmation email — an organizer can edit it for you.",
          },
        ]}
      />

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Entry code
        </p>
        <p className="mt-1 font-mono text-lg font-bold">{entry.campId}</p>

        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Group" value={entry.groupName} />
          <Row label="Choreographer" value={entry.choreographerName} />
          <Row label="Participants" value={String(entry.participantCount)} />
          <Row label="Age group" value={entry.ageRange} />
          <Row label="Song" value={entry.songTitle} />
        </dl>
      </section>

      <SongDelivery
        code={entry.campId}
        initialDelivery={entry.songDelivery}
        initialHasFile={entry.hasSongFile}
        songReady={entry.songReadyAt !== null}
        maxBytes={SONG_MAX_BYTES}
        uploadsAvailable={uploadsEnabled()}
        contactEmail={CONTACT_EMAIL}
      />

      <p className="mt-6 text-center text-sm">
        <Link href="/events" className="text-brand underline">
          ← Back to events
        </Link>
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}
