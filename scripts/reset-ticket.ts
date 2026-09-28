/**
 * Un-admit a ticket so it can be scanned again. A REHEARSAL TOOL.
 *
 *   ENV_FILE=<composed> npx tsx scripts/reset-ticket.ts DANDIYA-2026-BNQMCTGXN
 *   ENV_FILE=<composed> npx tsx scripts/reset-ticket.ts CODE1 CODE2 --commit
 *   ENV_FILE=<composed> npx tsx scripts/reset-ticket.ts --order DANDIYA-2026-X --commit
 *
 * WHY THIS EXISTS. There is no undo at the door and there never has been:
 * nothing in `src/` clears `checkedInAt`, so once a ticket is admitted it is
 * admitted for good. That is correct for a real night — an undo button at a
 * gate is a way to let people back out for free — and useless for a rehearsal,
 * where the same twelve tickets have to go through the door repeatedly.
 *
 * So this is deliberately a SCRIPT and not a screen. Adding an undo button to
 * satisfy a rehearsal would ship a hole into the real event.
 *
 * WHAT IT CLEARS
 *   Attendee.checkedInAt  -> null   (the ticket reads Valid again)
 *   LineItem.fulfilledAt  -> null   (pre-bought merch can be handed over again)
 *
 * WHAT IT DOES NOT TOUCH: money. Orders, payments, ledger entries and
 * `ServiceCap.sold` are left exactly as they are, because a rehearsal that
 * silently rewrote its own takings would make Round 8 meaningless. A reset
 * ticket is a guest walking back out and queueing again, not a refund.
 *
 * NOT IN THE VERIFY CHAIN — it writes to a live database.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
/** Reset every ticket on the same order, not just the one named. */
const WHOLE_ORDER = args.includes("--order");
const codes = args
  .filter((a) => !a.startsWith("--"))
  .map((c) => c.trim().toUpperCase());

async function main(): Promise<void> {
  const { db } = await import("../src/lib/db");

  if (codes.length === 0) {
    console.error("\nGive at least one campId, e.g. DANDIYA-2026-BNQMCTGXN\n");
    process.exit(1);
  }

  for (const code of codes) {
    const att = await db.attendee.findFirst({
      where: { campId: code },
      select: {
        id: true,
        name: true,
        campId: true,
        checkedInAt: true,
        orderId: true,
        order: {
          select: {
            registrantName: true,
            status: true,
            attendees: { select: { id: true, campId: true, checkedInAt: true } },
            lineItems: {
              select: {
                id: true,
                description: true,
                fulfilledAt: true,
                serviceType: { select: { kind: true } },
              },
            },
          },
        },
      },
    });

    if (!att) {
      console.log(`\n  ${code}  NOT FOUND`);
      continue;
    }

    const targets = WHOLE_ORDER
      ? att.order?.attendees ?? [att]
      : [{ id: att.id, campId: att.campId, checkedInAt: att.checkedInAt }];
    const admitted = targets.filter((t) => t.checkedInAt !== null);
    const merch = (att.order?.lineItems ?? []).filter(
      (li) => li.serviceType?.kind === "MERCH" && li.fulfilledAt !== null,
    );

    console.log(`\n  ${code}  ${att.order?.registrantName ?? "?"}  [${att.order?.status}]`);
    console.log(`    tickets in scope : ${targets.length}${WHOLE_ORDER ? " (whole order)" : ""}`);
    console.log(`    admitted now     : ${admitted.length}`);
    for (const t of admitted) {
      console.log(`      ${t.campId}  in at ${t.checkedInAt?.toISOString()}`);
    }
    console.log(`    merch handed over: ${merch.length}`);
    for (const m of merch) console.log(`      ${m.description}`);

    if (admitted.length === 0 && merch.length === 0) {
      console.log(`    nothing to reset — already clear`);
      continue;
    }

    if (!COMMIT) {
      console.log(`    DRY RUN — re-run with --commit`);
      continue;
    }

    const ids = targets.map((t) => t.id);
    const [a, m] = await db.$transaction([
      db.attendee.updateMany({
        where: { id: { in: ids } },
        data: { checkedInAt: null },
      }),
      db.lineItem.updateMany({
        where: { id: { in: merch.map((x) => x.id) } },
        data: { fulfilledAt: null, fulfilledByUserId: null },
      }),
    ]);
    console.log(`    reset: ${a.count} ticket(s), ${m.count} merch line(s)`);
  }

  if (!COMMIT) console.log("\n  Nothing written. Add --commit.\n");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
