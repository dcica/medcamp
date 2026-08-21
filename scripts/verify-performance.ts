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
    update: { admits: false, fulfillable: false, priceCents: 3000 },
    create: { orgId: org.id, key: FEE_KEY, name: "Competition Entry", priceCents: 3000, admits: false, fulfillable: false },
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
    update: { admits: true, fulfillable: false, priceCents: 1000 },
    create: { orgId: org.id, key: ADMIT_KEY, name: "Floor Entry", priceCents: 1000, admits: true, fulfillable: false },
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
      const full = join(process.cwd(), localUploadRoot(), ticket.path);
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
      check("oversize object deleted", (await storage.statObject(ticket.path)) === null);

      console.log("\n§7 offline escape hatch clears the object");
      await writeFile(full, Buffer.alloc(2048, 3));
      await completeSongUpload(campId);
      await chooseOfflineDelivery(campId);
      const offline = await db.performanceEntry.findUniqueOrThrow({ where: { id: created.entryId } });
      check("delivery switched to OFFLINE", offline.songDelivery === "OFFLINE", offline.songDelivery);
      check("songObjectPath cleared", offline.songObjectPath === null);
      check("object removed from storage", (await storage.statObject(ticket.path)) === null);

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
      await rm(join(process.cwd(), localUploadRoot(), org.id), { recursive: true, force: true });
    }
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
