/**
 * Competition-entry check — rule enforcement, the payment gate, and the song
 * upload round trip. Runs against a scratch event, then cleans up.
 *
 *   npx tsx scripts/verify-performance.ts
 *
 * Sibling of verify-pricing.ts / verify-validation.ts / verify-storage.ts.
 *
 * THE TWO THINGS THIS EXISTS TO PIN:
 *
 *   1. The PAYMENT GATE. getEntryByCode must return null for an unpaid entry
 *      exactly as it does for a bad code. That is what stops a cancelled
 *      checkout from reaching an upload slot it never paid for, and it is
 *      invisible in normal use — the happy path looks identical whether or not
 *      the status filter is there.
 *
 *   2. The PATH AGREEMENT. beginSongUpload hands the browser a path; the browser
 *      uploads straight to storage; completeSongUpload later verifies "the"
 *      object. If those two ever disagree, every upload silently reports as
 *      never-arrived — or worse, verification passes against a stale object. The
 *      path is derived, not stored, so this is exactly the kind of thing a
 *      refactor breaks quietly.
 *
 * The upload PUT is simulated by writing the bytes where the local-disk adapter
 * expects them, rather than going over HTTP. That is deliberate: this suite is
 * about the server contract, and standing up a dev server here would only test
 * Next's routing.
 */
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
// This must run BEFORE anything that touches src/lib/db — which is why every
// import of a server module below is a dynamic `await import`, not a top-level
// one: a static import would construct the Prisma client against the stale var.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-PERF";
const FEE_KEY = "verify-perf-fee";
const ADMIT_KEY = "verify-perf-admit";
const EMAIL = "verify-perf@example.org";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Asserts the call rejects, and that the message is the buyer-facing one. */
async function rejectsWith(
  label: string,
  fn: () => Promise<unknown>,
  expectedFragment: string,
) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, msg.includes(expectedFragment), `got: ${msg}`);
  }
}

const baseEntry = {
  registrant: { name: "Asha R", email: EMAIL, phone: "5551234567" },
  marketingConsent: false,
  groupName: "Shakti Steps",
  choreographerName: "Asha R",
  ageRange: "17+ years",
  songTitle: "Dholida",
  songDelivery: "UPLOAD" as const,
};

async function main() {
  const { createPerformanceEntry, getEntryByCode, beginSongUpload, completeSongUpload,
    chooseOfflineDelivery, listEntries, purgeEventSongs } =
    await import("../src/server/performance");
  const { confirmOrderPaid } = await import("../src/server/payments");
  const { getStorage } = await import("../src/lib/storage");

  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  // Relative dates, never literals: isRegistrationOpen refuses a finished
  // event, so a hardcoded endsAt would turn this red the day it passed.
  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "OPEN",
      code: CODE,
      name: "Performance Verification",
      startsAt: new Date(Date.now() + 30 * 24 * 3600_000),
      endsAt: new Date(Date.now() + 30 * 24 * 3600_000 + 4 * 3600_000),
      collectsAttendeeDetails: false,
      honorsMembership: false,
    },
  });

  // A FEE service: neither admission nor merch. Rules mirror Rhythms of
  // Navratri — 3–10 participants, 5–6 minutes.
  const fee = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: FEE_KEY } },
    update: { kind: "FEE", priceCents: 3000 },
    create: { orgId: org.id, key: FEE_KEY, name: "Competition Entry", priceCents: 3000, kind: "FEE" },
  });
  await db.serviceCap.create({
    data: {
      eventId: event.id, serviceTypeId: fee.id, priceCents: 3000, capacity: 40,
      minParticipants: 3, maxParticipants: 10,
      minDurationSeconds: 300, maxDurationSeconds: 360,
    },
  });

  // An ADMISSION service, to prove an entry cannot attach to one.
  const admit = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: ADMIT_KEY } },
    update: { kind: "ADMISSION", priceCents: 1000 },
    create: { orgId: org.id, key: ADMIT_KEY, name: "Floor Entry", priceCents: 1000, kind: "ADMISSION" },
  });
  await db.serviceCap.create({
    data: { eventId: event.id, serviceTypeId: admit.id, priceCents: 1000, capacity: 100 },
  });

  const input = { ...baseEntry, eventId: event.id, serviceKey: FEE_KEY };

  console.log("\n§1 group-size and duration rules are enforced server-side");
  await rejectsWith("2 participants rejected (min 3)",
    () => createPerformanceEntry({ ...input, participantCount: 2 }),
    "at least 3 participants");
  await rejectsWith("11 participants rejected (max 10)",
    () => createPerformanceEntry({ ...input, participantCount: 11 }),
    "at most 10 participants");
  await rejectsWith("4-minute performance rejected (min 5)",
    () => createPerformanceEntry({ ...input, participantCount: 5, durationSeconds: 240 }),
    "at least 5 minutes");
  await rejectsWith("7-minute performance rejected (max 6)",
    () => createPerformanceEntry({ ...input, participantCount: 5, durationSeconds: 420 }),
    "no longer than 6 minutes");

  console.log("\n§2 whitespace and shape (the Google Form accepted all of these)");
  await rejectsWith("whitespace group name rejected",
    () => createPerformanceEntry({ ...input, participantCount: 5, groupName: "   " }),
    "Group name is required");
  await rejectsWith("whitespace choreographer rejected",
    () => createPerformanceEntry({ ...input, participantCount: 5, choreographerName: " " }),
    "Choreographer");
  await rejectsWith("fractional participant count rejected",
    () => createPerformanceEntry({ ...input, participantCount: 4.5 }),
    "whole number");
  // The <select> on the form is a suggestion; the wire accepts anything. This is
  // what stops ageRange being the free text it replaced — "10 to 40" was a real
  // answer to the old form's age question.
  await rejectsWith("off-list age band rejected",
    () => createPerformanceEntry({ ...input, participantCount: 5, ageRange: "10 to 40" }),
    "age group from the list");

  console.log("\n§3 an entry may only attach to a FEE-kind service");
  await rejectsWith("admission service refused",
    () => createPerformanceEntry({ ...input, participantCount: 5, serviceKey: ADMIT_KEY }),
    "not offered for this event");
  await rejectsWith("unknown service refused",
    () => createPerformanceEntry({ ...input, participantCount: 5, serviceKey: "nope" }),
    "not offered for this event");

  console.log("\n§3b /register cannot sell an entry fee (the hole found on test)");
  const { createRegistration } = await import("../src/server/registration");
  await rejectsWith("plain registration refuses a fee-kind service",
    () => createRegistration({
      eventId: event.id,
      registrant: baseEntry.registrant,
      marketingConsent: false,
      quantities: [{ serviceKey: FEE_KEY, quantity: 1 }],
    }),
    "has its own form");
  // ...but must still sell admission on the same event, or a mixed event loses
  // its door. Prod RoN is fee-only; test RoN carries a stale floor-admission cap.
  const admitOrder = await createRegistration({
    eventId: event.id,
    registrant: baseEntry.registrant,
    marketingConsent: false,
    quantities: [{ serviceKey: ADMIT_KEY, quantity: 2 }],
  });
  check("plain registration still sells admission", admitOrder.totalCents === 2000, `${admitOrder.totalCents}`);

  const { offeringKindsByEvent } = await import("../src/server/performance");
  const kinds = (await offeringKindsByEvent([event.id])).get(event.id);
  check("event reports BOTH offering kinds", kinds?.hasFee === true && kinds?.hasOther === true,
    JSON.stringify(kinds));

  console.log("\n§4 a valid entry is created, unpaid, and INVISIBLE until paid");
  const created = await createPerformanceEntry({ ...input, participantCount: 6, durationSeconds: 330 });
  check("entry created", Boolean(created.entryId));
  check("total is the fee", created.totalCents === 3000, `${created.totalCents}`);

  const order = await db.order.findUniqueOrThrow({
    where: { id: created.orderId },
    include: { attendees: true, lineItems: true },
  });
  check("order is PENDING", order.status === "PENDING", order.status);
  check("fee-only order minted ONE receipt attendee", order.attendees.length === 1, `${order.attendees.length}`);
  check("line quantity is locked to 1", order.lineItems[0]?.quantity === 1, `${order.lineItems[0]?.quantity}`);
  check("entry is linked to the fee line",
    (await db.performanceEntry.findUniqueOrThrow({ where: { id: created.entryId } })).lineItemId === order.lineItems[0]?.id);

  // The attendee has NO campId yet — assigned at payment confirmation.
  check("no receipt code before payment", order.attendees[0]?.campId === null, String(order.attendees[0]?.campId));

  console.log("\n§5 the payment gate");
  await confirmOrderPaid(created.orderId, { method: "CASH", idempotencyKey: `verify-${created.orderId}` });
  const paid = await db.order.findUniqueOrThrow({
    where: { id: created.orderId }, include: { attendees: true },
  });
  const campId = paid.attendees[0]!.campId!;
  check("receipt code assigned on confirmation", Boolean(campId), campId);

  const view = await getEntryByCode(campId);
  check("paid entry resolves by code", view !== null);
  check("resolved entry is the right group", view?.groupName === "Shakti Steps", view?.groupName);
  check("bogus code returns null", (await getEntryByCode("RON-2026-ZZZZZZZZ")) === null);
  check("empty code returns null", (await getEntryByCode("")) === null);

  // The invariant that matters: an UNPAID entry must be indistinguishable from
  // a bad code. Build a second entry and leave it PENDING.
  const unpaid = await createPerformanceEntry({ ...input, participantCount: 4, groupName: "Unpaid Group" });
  const unpaidOrder = await db.order.findUniqueOrThrow({
    where: { id: unpaid.orderId }, include: { attendees: true },
  });
  // Force a code onto the unpaid attendee so the ONLY thing hiding it is status.
  await db.attendee.update({
    where: { id: unpaidOrder.attendees[0]!.id },
    data: { campId: `${CODE}-UNPAID01` },
  });
  check("UNPAID entry with a valid code still returns null",
    (await getEntryByCode(`${CODE}-UNPAID01`)) === null);

  console.log("\n§6 song upload round trip");
  const storage = getStorage();
  if (!storage) {
    console.log("  ..  no storage adapter — skipping");
  } else {
    console.log(`  ..  adapter: ${storage.name}`);
    await rejectsWith("completing with no file uploaded fails",
      () => completeSongUpload(campId), "didn't receive the file");

    const ticket = await beginSongUpload(campId);
    check("upload ticket issued", Boolean(ticket.url));
    check("ticket declares the MP3 content type", ticket.contentType === "audio/mpeg", ticket.contentType);
    check("ticket declares the 10 MiB cap", ticket.maxBytes === 10 * 1024 * 1024, `${ticket.maxBytes}`);

    if (storage.name === "local-disk") {
      // Simulate the browser's direct PUT.
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join, dirname } = await import("node:path");
      const { localUploadRoot } = await import("../src/lib/storage");
      // Bucket-nested, matching the local adapter. The whole point of this
      // section is that begin() and complete() agree on the path, so the
      // simulated PUT must land exactly where the adapter would put it.
      const full = join(process.cwd(), localUploadRoot(), "songs", ticket.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, Buffer.alloc(4096, 3));

      // THE path-agreement check: complete() must find what begin() described.
      await completeSongUpload(campId);
      const afterUpload = await db.performanceEntry.findUniqueOrThrow({ where: { id: created.entryId } });
      check("songObjectPath recorded", afterUpload.songObjectPath === ticket.path, String(afterUpload.songObjectPath));
      check("delivery is UPLOAD", afterUpload.songDelivery === "UPLOAD", afterUpload.songDelivery);
      check("songReadyAt still null (coordinator gates the running order)", afterUpload.songReadyAt === null);

      // Oversize: rejected AND removed, not left occupying the bucket.
      await writeFile(full, Buffer.alloc(10 * 1024 * 1024 + 1, 3));
      await rejectsWith("oversize upload rejected", () => completeSongUpload(campId), "larger than 10 MB");
      check("oversize object deleted", (await storage.statObject("songs", ticket.path)) === null);

      console.log("\n§7 offline escape hatch clears the object");
      await writeFile(full, Buffer.alloc(2048, 3));
      await completeSongUpload(campId);
      await chooseOfflineDelivery(campId);
      const offline = await db.performanceEntry.findUniqueOrThrow({ where: { id: created.entryId } });
      check("delivery switched to OFFLINE", offline.songDelivery === "OFFLINE", offline.songDelivery);
      check("songObjectPath cleared", offline.songObjectPath === null);
      check("object removed from storage", (await storage.statObject("songs", ticket.path)) === null);

      console.log("\n§8 roster and purge");
      const roster = await listEntries(event.id);
      check("roster shows only the PAID entry", roster.length === 1, `${roster.length}`);
      check("roster row carries the receipt code", roster[0]?.campId === campId, roster[0]?.campId);

      // Re-upload so purge has something to remove.
      await beginSongUpload(campId);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, Buffer.alloc(1024, 3));
      await completeSongUpload(campId);
      const purged = await purgeEventSongs(event.id);
      check("purge removed one object", purged === 1, `${purged}`);
      check("entry row survives the purge",
        (await db.performanceEntry.findUnique({ where: { id: created.entryId } })) !== null);
      check("songObjectPath cleared by purge",
        (await db.performanceEntry.findUniqueOrThrow({ where: { id: created.entryId } })).songObjectPath === null);

      const { rm } = await import("node:fs/promises");
      await rm(join(process.cwd(), localUploadRoot(), "songs", org.id), { recursive: true, force: true });
    }
  }

  console.log("\n§9 the confirmation email is an entry receipt, not a ticket");
  const { confirmationSubject, confirmationText } =
    await import("../src/lib/confirmationEmail");
  const baseMail = {
    to: "a@b.c", registrantName: "Asha Rao", eventName: "Performance Verification",
    confirmUrl: "https://example.test/confirm/x", campIds: [campId],
    lineItems: [{ description: "Competition Entry", quantity: 1, amountCents: 3000 }],
    merch: [], totalPaidCents: 3000, venue: null,
    startsAt: new Date(), endsAt: new Date(), allowsRefunds: false,
  };
  // The registration wording must be untouched by the entry branch.
  check("registration subject unchanged",
    confirmationSubject(baseMail).endsWith("registration confirmed"),
    confirmationSubject(baseMail));
  check("registration body still says QR badge",
    confirmationText(baseMail).includes("View your QR badge"));

  const entryMail = { ...baseMail, performanceEntry: {
    groupName: "Shakti Steps", songTitle: "Dholida", songNeeded: true,
    entryUrl: "https://example.test/perform/" + campId } };
  check("entry subject says entry, not registration",
    confirmationSubject(entryMail).endsWith("entry confirmed"),
    confirmationSubject(entryMail));
  const entryBody = confirmationText(entryMail);
  check("entry body states it is NOT a ticket",
    entryBody.includes("receipt, not a ticket"));
  check("entry body never claims to admit guests",
    !entryBody.includes("admits") || entryBody.includes("does not admit"));
  check("entry body carries the music call to action",
    entryBody.includes("WE STILL NEED YOUR MUSIC") && entryBody.includes(campId));
  check("entry body names the group and song",
    entryBody.includes("Shakti Steps") && entryBody.includes("Dholida"));

  const doneMail = { ...entryMail, performanceEntry: { ...entryMail.performanceEntry, songNeeded: false } };
  check("music-received variant drops the chase",
    !confirmationText(doneMail).includes("WE STILL NEED"));


  console.log("\n§10 the music split classifies every combination");
  const { musicState, isMusicOutstanding, MUSIC_STATES, MUSIC_SLUG } =
    await import("../src/lib/musicState");

  // Every combination of the three facts, including the ones the write paths
  // are supposed to prevent. Precedence is the whole point: songReadyAt beats
  // everything (a track handed over on a USB stick is DONE while delivery is
  // still OFFLINE), and a file present beats OFFLINE (something arrived — the
  // next step is to listen to it, not to phone them).
  const truthTable: [("UPLOAD" | "OFFLINE"), boolean, boolean, string][] = [
    ["OFFLINE", false, false, "OFFLINE"],
    ["OFFLINE", true, false, "RECEIVED"],
    ["OFFLINE", false, true, "CONFIRMED"],
    ["OFFLINE", true, true, "CONFIRMED"],
    ["UPLOAD", false, false, "AWAITING_UPLOAD"],
    ["UPLOAD", true, false, "RECEIVED"],
    ["UPLOAD", false, true, "CONFIRMED"],
    ["UPLOAD", true, true, "CONFIRMED"],
  ];
  for (const [songDelivery, hasSongFile, ready, expected] of truthTable) {
    const facts = { songDelivery, hasSongFile, songReadyAt: ready ? new Date() : null };
    const got = musicState(facts);
    check(
      `${songDelivery} file=${hasSongFile ? "Y" : "N"} ready=${ready ? "Y" : "N"} -> ${expected}`,
      got === expected,
      got,
    );
    check(
      `  ...and outstanding is exactly "not confirmed"`,
      isMusicOutstanding(facts) === (expected !== "CONFIRMED"),
    );
  }

  console.log("\n§11 summary arithmetic (pure, on hand-built rows)");
  const { rosterSummary, CHANGEOVER_SECONDS } = await import("../src/server/performance");
  type RosterEntry = Awaited<ReturnType<typeof listEntries>>[number];

  function shapeOf(m: string) {
    if (m === "OFFLINE") return { songDelivery: "OFFLINE" as const, hasSongFile: false, songReadyAt: null };
    if (m === "AWAITING_UPLOAD") return { songDelivery: "UPLOAD" as const, hasSongFile: false, songReadyAt: null };
    if (m === "RECEIVED") return { songDelivery: "UPLOAD" as const, hasSongFile: true, songReadyAt: null };
    return { songDelivery: "UPLOAD" as const, hasSongFile: true, songReadyAt: new Date() };
  }

  // [music, durationSeconds, ageBand, dancers, usesProps, needsStagePrep, feeCents]
  const spec: [string, number | null, string, number, boolean | null, boolean | null, number][] = [
    ["OFFLINE", 300, "7–11 years", 5, true, true, 3000],
    ["OFFLINE", 310, "7–11 years", 5, true, false, 3000],
    ["OFFLINE", null, "12–16 years", 5, null, null, 3000],
    ["AWAITING_UPLOAD", 320, "12–16 years", 5, null, null, 3000],
    ["AWAITING_UPLOAD", null, "12–16 years", 5, null, null, 3000],
    ["RECEIVED", 330, "17+ years", 5, true, true, 3000],
    ["RECEIVED", 340, "17+ years", 5, false, false, 3000],
    ["RECEIVED", 350, "17+ years", 5, null, null, 3000],
    ["CONFIRMED", 300, "17+ years", 5, true, null, 3000],
    ["CONFIRMED", 310, "Mixed ages", 5, null, null, 3000],
    // A refunded fee line: the entry survives (lineItem is SetNull) and must
    // stop counting as revenue.
    ["CONFIRMED", 320, "Mixed ages", 5, null, null, 0],
    ["CONFIRMED", null, "Mixed ages", 7, null, false, 3000],
  ];

  const fixture: RosterEntry[] = spec.map(([m, dur, band, n, props, stage, fee], i) => ({
    entryId: `fix-${i}`,
    orderId: `ord-${i}`,
    eventName: "Fixture",
    groupName: `Group ${i}`,
    choreographerName: "C",
    participantCount: n,
    ageRange: band,
    songTitle: "S",
    campId: `FIX-${i}`,
    durationSeconds: dur,
    usesProps: props,
    needsStagePrep: stage,
    category: null,
    registrantName: "R",
    registrantEmail: i % 2 === 0 ? "even@example.org" : `odd${i}@example.org`,
    registrantPhone: "5550000000",
    feeCents: fee,
    createdAt: new Date(),
    ...shapeOf(m),
  }));

  const sum = rosterSummary(fixture, { capacity: 40, slotSeconds: 4 * 3600 });
  check("entries", sum.entries === 12, `${sum.entries}`);
  check("capacity denominator passed through", sum.capacity === 40, `${sum.capacity}`);
  check("dancers", sum.dancers === 62, `${sum.dancers}`);
  check("declared runtime (9 of 12 declared)", sum.declaredRuntimeSeconds === 2880, `${sum.declaredRuntimeSeconds}`);
  check("entries with no declared length", sum.entriesMissingDuration === 3, `${sum.entriesMissingDuration}`);
  check("changeover assumption is 60s", CHANGEOVER_SECONDS === 60, `${CHANGEOVER_SECONDS}`);
  check("changeover is BETWEEN acts (n-1), not per act",
    sum.changeoverSeconds === 11 * 60, `${sum.changeoverSeconds}`);
  check("show estimate = runtime + changeover",
    sum.showEstimateSeconds === 2880 + 660, `${sum.showEstimateSeconds}`);
  check("booked slot carried through", sum.slotSeconds === 14400, `${sum.slotSeconds}`);
  check("entry fee revenue excludes the refunded line",
    sum.entryFeeCents === 33000, `${sum.entryFeeCents}`);

  // THE POINT OF THE THREE-STATE COUNTS: 4 use props, 1 does not, and SEVEN
  // never answered. Reporting "4 use props" out of 12 would be a false
  // statement about the show — the true figure is somewhere between 4 and 11.
  check("props: yes", sum.props.yes === 4, `${sum.props.yes}`);
  check("props: no", sum.props.no === 1, `${sum.props.no}`);
  check("props: UNANSWERED counted separately", sum.props.unanswered === 7, `${sum.props.unanswered}`);
  check("props: three states account for every entry",
    sum.props.yes + sum.props.no + sum.props.unanswered === sum.entries);
  check("stage prep: yes", sum.stagePrep.yes === 2, `${sum.stagePrep.yes}`);
  check("stage prep: no", sum.stagePrep.no === 3, `${sum.stagePrep.no}`);
  check("stage prep: UNANSWERED counted separately", sum.stagePrep.unanswered === 7, `${sum.stagePrep.unanswered}`);
  check("stage prep: three states account for every entry",
    sum.stagePrep.yes + sum.stagePrep.no + sum.stagePrep.unanswered === sum.entries);

  check("age bands in published order",
    sum.ageBands.map((b) => b.band).join("|") ===
      "7–11 years|12–16 years|17+ years|Mixed ages",
    sum.ageBands.map((b) => b.band).join("|"));
  check("age band entry counts", sum.ageBands.map((b) => b.entries).join(",") === "2,3,4,3",
    sum.ageBands.map((b) => b.entries).join(","));
  check("age band dancer counts", sum.ageBands.map((b) => b.dancers).join(",") === "10,15,20,17",
    sum.ageBands.map((b) => b.dancers).join(","));

  console.log("\n§11b the anti-drift invariant: chip count === filtered row count");
  // This is the bug that shipped: the summary tile counted `songReadyAt === null`
  // in page.tsx while each card branched over three fields in EntryRoster.tsx.
  // Both now route through musicState(), so a chip and the number above it
  // cannot disagree. Asserted rather than assumed, because the two call sites
  // are still in different files.
  for (const state of MUSIC_STATES) {
    const filtered = fixture.filter((e) => musicState(e) === state).length;
    check(`chip ${state} (${filtered}) matches summary`, sum.music[state] === filtered,
      `summary=${sum.music[state]} rows=${filtered}`);
  }
  check("music states partition the roster",
    MUSIC_STATES.reduce((n, s) => n + sum.music[s], 0) === sum.entries);
  check("outstanding = everything but confirmed",
    sum.musicOutstanding === sum.entries - sum.music.CONFIRMED, `${sum.musicOutstanding}`);
  check("outstanding on this fixture is 8 (3 offline + 2 not sent + 3 unchecked)",
    sum.musicOutstanding === 8, `${sum.musicOutstanding}`);

  console.log("\n§12 the capacity denominator is FEE-kind only");
  const { feeCapacity, eventRoster, performanceReportRows, PERFORMANCE_REPORT_HEADER } =
    await import("../src/server/performance");
  // This event carries a 40-slot FEE cap and a 100-seat ADMISSION cap, which is
  // the shape prod RoN drifts into and the shape a genuinely mixed event (a
  // competition plus floor tickets) has on purpose. A naive sum reads 140.
  check("fee capacity ignores the admission cap on the same event",
    (await feeCapacity(event.id)) === 40, `${await feeCapacity(event.id)}`);

  console.log("\n§13 roster + CSV against real rows");
  // Compose the four music states directly on the rows: the state a coordinator
  // has to act on is what is being checked here, not how it got there, and
  // driving it through storage would make this section depend on which adapter
  // happens to be configured.
  await db.performanceEntry.update({
    where: { id: created.entryId },
    data: { songDelivery: "OFFLINE", songObjectPath: null, songReadyAt: new Date() },
  });

  async function paidEntry(over: {
    groupName: string;
    participantCount: number;
    ageRange: string;
    durationSeconds?: number;
    usesProps?: boolean;
    needsStagePrep?: boolean;
  }) {
    const c = await createPerformanceEntry({ ...input, ...over });
    await confirmOrderPaid(c.orderId, { method: "CASH", idempotencyKey: `verify-${c.orderId}` });
    return c;
  }

  const gOffline = await paidEntry({ groupName: "Chase Me", participantCount: 3, ageRange: "7–11 years" });
  const gNotSent = await paidEntry({ groupName: "Not Sent", participantCount: 4, durationSeconds: 300,
    ageRange: "12–16 years", usesProps: true, needsStagePrep: false });
  // Comma AND quotes in a real group name — the field that breaks a CSV row.
  const gReceived = await paidEntry({ groupName: 'Naach, "Baby" Naach', participantCount: 5,
    durationSeconds: 360, ageRange: "17+ years", usesProps: false, needsStagePrep: true });
  const gDone = await paidEntry({ groupName: "All Set", participantCount: 6, durationSeconds: 330,
    ageRange: "Mixed ages", usesProps: true, needsStagePrep: true });

  await db.performanceEntry.update({ where: { id: gOffline.entryId },
    data: { songDelivery: "OFFLINE", songObjectPath: null, songReadyAt: null } });
  await db.performanceEntry.update({ where: { id: gNotSent.entryId },
    data: { songDelivery: "UPLOAD", songObjectPath: null, songReadyAt: null } });
  await db.performanceEntry.update({ where: { id: gReceived.entryId },
    data: { songDelivery: "UPLOAD", songObjectPath: "verify/song.mp3", songReadyAt: null } });
  await db.performanceEntry.update({ where: { id: gDone.entryId },
    data: { songDelivery: "UPLOAD", songObjectPath: "verify/song.mp3", songReadyAt: new Date() } });

  const live = await eventRoster(event);
  check("roster holds the five PAID entries (the pending one stays invisible)",
    live.entries.length === 5, `${live.entries.length}`);
  check("default sort still puts the three needing a human first",
    live.entries.slice(0, 3).every((e) => musicState(e) !== "CONFIRMED") &&
      live.entries.slice(3).every((e) => musicState(e) === "CONFIRMED"),
    live.entries.map((e) => musicState(e)).join(","));

  const ls = live.summary;
  check("live capacity is the fee cap", ls.capacity === 40, `${ls.capacity}`);
  check("live dancers", ls.dancers === 24, `${ls.dancers}`);
  check("live declared runtime (one entry gave none)", ls.declaredRuntimeSeconds === 1320,
    `${ls.declaredRuntimeSeconds}`);
  check("live missing lengths", ls.entriesMissingDuration === 1, `${ls.entriesMissingDuration}`);
  check("live show estimate", ls.showEstimateSeconds === 1320 + 4 * 60, `${ls.showEstimateSeconds}`);
  check("live music split",
    ls.music.OFFLINE === 1 && ls.music.AWAITING_UPLOAD === 1 &&
      ls.music.RECEIVED === 1 && ls.music.CONFIRMED === 2,
    JSON.stringify(ls.music));
  check("live outstanding", ls.musicOutstanding === 3, `${ls.musicOutstanding}`);
  check("live props three-state", ls.props.yes === 2 && ls.props.no === 1 && ls.props.unanswered === 2,
    JSON.stringify(ls.props));
  check("live stage-prep three-state",
    ls.stagePrep.yes === 2 && ls.stagePrep.no === 1 && ls.stagePrep.unanswered === 2,
    JSON.stringify(ls.stagePrep));
  check("live entry-fee revenue", ls.entryFeeCents === 15000, `${ls.entryFeeCents}`);
  for (const state of MUSIC_STATES) {
    const filtered = live.entries.filter((e) => musicState(e) === state).length;
    check(`live chip ${state} matches summary`, ls.music[state] === filtered,
      `summary=${ls.music[state]} rows=${filtered}`);
  }

  const { toCsv } = await import("../src/lib/csv");
  const allRows = await performanceReportRows(event.id);
  const csv = toCsv(PERFORMANCE_REPORT_HEADER, allRows).split("\n");
  check("CSV header is the pinned column order",
    csv[0] === "receipt_code,group_name,choreographer,participants,age_band,category,song_title," +
      "duration_seconds,music_state,song_delivery,song_ready_at,uses_props,needs_stage_prep," +
      "registrant_name,registrant_email,registrant_phone,fee_usd,entered_at",
    csv[0]);
  check("CSV has one line per entry plus the header", csv.length === 6, `${csv.length}`);
  check("a comma-and-quote group name is escaped, not column-shifted",
    csv.some((l) => l.includes('"Naach, ""Baby"" Naach"')),
    csv.find((l) => l.includes("Naach")) ?? "not found");

  const byGroup = new Map(allRows.map((r) => [r.group_name, r]));
  check("CSV records the fee actually paid", byGroup.get("All Set")?.fee_usd === "30.00",
    byGroup.get("All Set")?.fee_usd);
  check("CSV: an unanswered Boolean? is BLANK, never \"no\"",
    byGroup.get("Chase Me")?.uses_props === "", `"${byGroup.get("Chase Me")?.uses_props}"`);
  check("CSV: a real no is \"no\"", byGroup.get('Naach, "Baby" Naach')?.uses_props === "no",
    byGroup.get('Naach, "Baby" Naach')?.uses_props);
  check("CSV: a real yes is \"yes\"", byGroup.get("Not Sent")?.uses_props === "yes",
    byGroup.get("Not Sent")?.uses_props);
  check("CSV: no declared length is blank, not 0",
    byGroup.get("Chase Me")?.duration_seconds === "", `"${byGroup.get("Chase Me")?.duration_seconds}"`);
  check("CSV: music_state uses the same slugs as the chips",
    byGroup.get("Chase Me")?.music_state === MUSIC_SLUG.OFFLINE &&
      byGroup.get("Not Sent")?.music_state === MUSIC_SLUG.AWAITING_UPLOAD &&
      byGroup.get('Naach, "Baby" Naach')?.music_state === MUSIC_SLUG.RECEIVED &&
      byGroup.get("All Set")?.music_state === MUSIC_SLUG.CONFIRMED);

  // An export taken while a chip is active must be that chip's list — handing
  // over all forty rows during a chase is the wrong file.
  for (const state of MUSIC_STATES) {
    const scoped = await performanceReportRows(event.id, state);
    check(`CSV scoped to ${state} matches the chip count`,
      scoped.length === ls.music[state], `${scoped.length} vs ${ls.music[state]}`);
  }

  await cleanup(org.id);
}

/** Remove everything this script creates (cascades don't cover payments/ledger). */
async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({ where: { orgId, code: CODE } });
  for (const event of events) {
    const orders = await db.order.findMany({ where: { eventId: event.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } }, select: { id: true },
    });
    await db.ledgerEntry.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    // performance_entries cascade from the event.
    await db.event.delete({ where: { id: event.id } });
  }
  await db.serviceType.deleteMany({ where: { orgId, key: { in: [FEE_KEY, ADMIT_KEY] } } });
}

main()
  .then(async () => {
    await db.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
