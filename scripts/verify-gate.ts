/**
 * Event-gate regression check — the door behaviour that no design mock shows.
 *
 *   npx tsx scripts/verify-gate.ts
 *
 * Sibling of verify-pricing.ts / verify-validation.ts / verify-performance.ts.
 * Runs against a scratch event on the LOCAL database, then cleans up.
 *
 * WHY THIS FILE EXISTS: `/gate` is the door screen for a dandiya night with a
 * hard date and no rehearsal, and it is about to be restyled — the resolved
 * guest moves to the top of the screen, pickup rows change size, sections are
 * reordered. Everything that actually matters at that door is invisible in a
 * mock: whether a re-scan double-counts, what the volunteer's typed characters
 * mean, whether a camera decoding the same QR ten times a second fires ten
 * lookups, whether a cash button that merely LOOKS disabled is still refused by
 * the server. This suite pins those, so the redesign can move every pixel.
 *
 * WHAT IT ASSERTS AGAINST: server functions, exported rules and pure helpers —
 * never the component tree. A row here must survive `GateStation.tsx` being
 * rewritten from scratch. Three rules were trapped inside components and were
 * lifted out (unchanged) so they could be pinned at all:
 *
 *   - `expandTicketCode`  (@/lib/ticketCode)   — was inline in `ManualEntry`
 *   - `isDuplicateDecode` (@/lib/scanDebounce) — was inline in `QrScanner`
 *   - `formatVenueTime`   (@/lib/eventTime)    — was an inline toLocaleTimeString
 *
 * The server ACTIONS (src/app/gate/actions.ts) can't be called from a script:
 * they open with `requireRole`/`requireTill`, which need a session cookie and a
 * request scope. So §3 pins the till decision two ways instead — as a predicate
 * over real Membership rows, and as a source-level assertion that every
 * cash-recording action is still wrapped in `requireTill`. That second one is
 * deliberately structural, and it is the only structural row in the file: 4B
 * renders the cash paths disabled, and a disabled button is a courtesy, not a
 * guard. If the server check is ever dropped "because the UI hides it now",
 * this is what goes red.
 *
 * ── ONE BEHAVIOUR WAS FIXED, NOT PINNED (§6) ──
 * A FEE-kind service "buys a slot and admits nobody" (schema.prisma), and the
 * walk-up form sells one under a "NOT A TICKET · NO FLOOR ACCESS" banner. The
 * server did not mean it: selling a competition entry at the gate minted an
 * attendee, admitted them and incremented the headcount, and the entrant's
 * receipt code then scanned at the door as a valid paid ticket. `admitsNobody`
 * + `admitOrderAttendees` in src/server/gate.ts close both; §6 is what holds
 * them closed.
 */
import type { Role } from "@prisma/client";
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
// This must run BEFORE anything that touches src/lib/db — which is why every
// import of an app module below is a dynamic `await import`, not a top-level one.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-GATE";
const ADM_KEY = "vg-admission";
const MERCH_KEY = "vg-merch";
const FEE_KEY = "vg-fee";
/** Every ticket id this script mints. Crockford-safe: no I, L, O or U. */
const PAID_ID = `${CODE}-K7M2XQ9T`;
const MERCH_ID = `${CODE}-M3RCH001`;
const UNPAID_ID = `${CODE}-9NPA1D01`;
const TILL_EMAIL = "verify-gate-till@example.test";
const NOTILL_EMAIL = "verify-gate-notill@example.test";

/** The roles the gate opens for — mirrors GATE_ROLES in src/app/gate/actions.ts. */
const GATE_ROLES: Role[] = [
  "REGISTRATION_TILL",
  "REGISTRATION_NO_TILL",
  "STATION_VOLUNTEER",
  "POS_TILL",
];

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Asserts the call rejects, and that the message is the one staff will read. */
async function rejectsWith(
  label: string,
  fn: () => Promise<unknown>,
  expectedFragment: string,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, msg.includes(expectedFragment), `got: ${msg}`);
  }
}

async function main(): Promise<void> {
  const { expandTicketCode } = await import("../src/lib/ticketCode");
  const { isDuplicateDecode, DUPLICATE_SCAN_WINDOW_MS } = await import(
    "../src/lib/scanDebounce"
  );
  const { formatVenueTime, VENUE_TIME_ZONE } = await import("../src/lib/eventTime");
  const { normalizeCampId } = await import("../src/lib/campId");
  const { satisfiesRole, canRecordCash } = await import("../src/server/session");
  const gate = await import("../src/server/gate");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§1 what the volunteer's typed characters mean");
  // The door is staffed for ONE event, so the prefix is fixed text and only the
  // token is typed. 4B keeps this ("GB-2026W- fixed prefix with whole-id
  // pass-through"), so the rule must outlive the field being moved to the
  // bottom of the screen.
  eq("bare token gets the event prefix", expandTicketCode("GB-2026W", "K7M2XQ9T"), "GB-2026W-K7M2XQ9T");
  eq("lower case is upper-cased", expandTicketCode("GB-2026W", "k7m2xq9t"), "GB-2026W-K7M2XQ9T");
  eq("surrounding space is trimmed", expandTicketCode("GB-2026W", "  k7m2xq9t \n"), "GB-2026W-K7M2XQ9T");
  eq("empty is not a lookup", expandTicketCode("GB-2026W", ""), null);
  eq("whitespace alone is not a lookup", expandTicketCode("GB-2026W", "   "), null);

  // THE BOUNDARY: a hyphen anywhere means "this is a whole id, leave it alone".
  // Someone arriving at the Dandiya door holding a Garba ticket must see it
  // resolve against the WRONG EVENT, not a bogus "no match".
  eq("a whole id passes through unprefixed", expandTicketCode("GB-2026W", "RON-2026-ABCD1234"), "RON-2026-ABCD1234");
  eq("another event's id is NOT re-prefixed", expandTicketCode("GB-2026W", "GARBA-2026-K7M2XQ9T"), "GARBA-2026-K7M2XQ9T");
  eq("this event's own full id is idempotent", expandTicketCode("GB-2026W", "GB-2026W-K7M2XQ9T"), "GB-2026W-K7M2XQ9T");
  eq("legacy sequential id survives", expandTicketCode("GB-2026W", "GB-2026W-0001"), "GB-2026W-0001");
  // A leading hyphen is still a hyphen — the rule is deliberately dumb, because
  // a smarter one would have to guess, and guessing at a door is worse.
  eq("a leading hyphen counts as a whole id", expandTicketCode("GB-2026W", "-K7M2"), "-K7M2");

  // The typed value then meets normalizeCampId, whose confusable mapping is
  // scoped to the LAST segment. RON-2026 is a live event code; mapping O→0
  // across the whole string would make it unfindable.
  eq("O and I are decoded in the token", normalizeCampId("ron-2026-k7m2xq9o"), "RON-2026-K7M2XQ90");
  eq("the event code is left alone", normalizeCampId("RON-2026-ABCD1234"), "RON-2026-ABCD1234");
  eq("legacy numeric ids are untouched", normalizeCampId("GB-2026W-0042"), "GB-2026W-0042");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§2 the continuous camera does not re-fire on one badge");
  // 4B: "Unchanged and required: continuous camera, 3s duplicate-decode
  // debounce". A live camera decodes ~10×/second; without this, one guest
  // holding up one phone is ten lookups and a flickering screen.
  eq("the window is 3 seconds", DUPLICATE_SCAN_WINDOW_MS, 3000);
  const first = { text: "GB-2026W-K7M2XQ9T", at: 1_000_000 };
  check("same code, same instant, suppressed", isDuplicateDecode(first, first.text, first.at));
  check("same code 1.5s later, suppressed", isDuplicateDecode(first, first.text, first.at + 1500));
  check("same code 2.999s later, suppressed", isDuplicateDecode(first, first.text, first.at + 2999));
  check("same code at exactly 3.000s, ALLOWED", !isDuplicateDecode(first, first.text, first.at + 3000));
  check("same code 3.001s later, allowed", !isDuplicateDecode(first, first.text, first.at + 3001));
  check("a different code is never suppressed", !isDuplicateDecode(first, "GB-2026W-ZZZZZZZZ", first.at + 5));
  // A → B → A inside the window fires three times: only the LAST decode is
  // remembered, and the second A is a volunteer taking a second look at that
  // guest, not the same badge sitting in frame.
  const second = { text: "GB-2026W-ZZZZZZZZ", at: first.at + 5 };
  check("A→B→A inside the window is three scans", !isDuplicateDecode(second, first.text, second.at + 5));
  check("an empty history suppresses nothing", !isDuplicateDecode({ text: "", at: 0 }, "GB-2026W-K7M2XQ9T", 1));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3 cash is gated by the SERVER, not by the screen");
  // 4B renders the till-gated actions disabled with a reason. That is a
  // courtesy; a hand-rolled POST never sees it. These rows are the real gate.
  eq("a coordinator always holds the till", canRecordCash({ role: "COORDINATOR", canHoldTill: false }), true);
  eq("registration desk WITH a till may take cash", canRecordCash({ role: "REGISTRATION_TILL", canHoldTill: true }), true);
  eq("registration desk WITHOUT a till may not", canRecordCash({ role: "REGISTRATION_NO_TILL", canHoldTill: false }), false);
  eq("a station volunteer may not", canRecordCash({ role: "STATION_VOLUNTEER", canHoldTill: false }), false);
  eq("a POS till holder may", canRecordCash({ role: "POS_TILL", canHoldTill: true }), true);
  // The till is a capability, not a role: a coordinator can hand one to anybody.
  eq("the till is the capability, not the role", canRecordCash({ role: "STATION_VOLUNTEER", canHoldTill: true }), true);
  eq("a gate role is not enough on its own", canRecordCash({ role: "REGISTRATION_TILL", canHoldTill: false }), false);

  eq("coordinator satisfies every gate role", satisfiesRole("COORDINATOR", GATE_ROLES), true);
  eq("a station volunteer staffs the gate", satisfiesRole("STATION_VOLUNTEER", GATE_ROLES), true);
  eq("committee admin does not staff the gate", satisfiesRole("COMMITTEE_ADMIN", GATE_ROLES), false);
  eq("a doctor does not staff the gate", satisfiesRole("DOCTOR", GATE_ROLES), false);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3b the guard reads the DATABASE, not the session token");
  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);
  const tillMember = await makeMember(org.id, TILL_EMAIL, "REGISTRATION_TILL", true);
  const noTillMember = await makeMember(org.id, NOTILL_EMAIL, "REGISTRATION_NO_TILL", false);
  eq("till holder row grants cash", canRecordCash(tillMember), true);
  eq("no-till row refuses cash", canRecordCash(noTillMember), false);
  // Revoking the till takes effect without a re-login, because the role and the
  // capability are re-read per request from Membership (see session.ts).
  const revoked = await db.membership.update({
    where: { id: tillMember.id },
    data: { canHoldTill: false },
  });
  eq("revoking the till is immediate", canRecordCash(revoked), false);

  console.log("\n§3c every cash-recording action still calls requireTill");
  // Structural on purpose — see the file header. Reads the action module's
  // source, not the component's.
  const actionsSrc = readFileSync(join(process.cwd(), "src/app/gate/actions.ts"), "utf8");
  const CASH_ACTIONS = ["sellAndAdmit", "confirmUnpaidAndAdmit", "sellMerch"];
  const OPEN_ACTIONS = ["resolveGate", "admit", "fulfill", "comp"];
  for (const name of CASH_ACTIONS) {
    const body = actionBody(actionsSrc, name);
    check(`${name}() is wrapped in requireTill`, /requireTill\(/.test(body), body ? "" : "action not found");
  }
  for (const name of OPEN_ACTIONS) {
    const body = actionBody(actionsSrc, name);
    check(`${name}() requires a gate role`, /requireRole\(/.test(body), body ? "" : "action not found");
    check(`${name}() does not claim a till`, !/requireTill\(/.test(body));
  }
  // A new action added to this file must be classified above, or it is silently
  // unguarded here.
  const declared = [...actionsSrc.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  eq("no unclassified gate action", declared.filter((n) => ![...CASH_ACTIONS, ...OPEN_ACTIONS].includes(n)), []);
  // And the role list itself, so a silently widened gate shows up here.
  const rolesInSource = [...(/const GATE_ROLES = \[([^\]]+)\]/.exec(actionsSrc)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
  eq("the gate's role list is unchanged", rolesInSource, GATE_ROLES);

  // ───────────────────────────────────────────────────────────────────────────
  // Fixtures. ACTIVE (the gate only opens for an ACTIVE general event) but with
  // a start date well in the PAST: `getActiveGeneralEvent` takes the newest by
  // start time, so a future date would make this scratch event "the" gate for
  // anyone with a dev server open while this runs.
  const startsAt = new Date(Date.now() - 730 * 24 * 3600_000);
  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "ACTIVE",
      code: CODE,
      name: "Gate Verification Night",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3600_000),
      collectsAttendeeDetails: false,
      honorsMembership: false,
    },
  });
  const admission = await service(org.id, ADM_KEY, "Dandia Entry", "ADMISSION", 2500);
  const merch = await service(org.id, MERCH_KEY, "Dandiya Sticks", "MERCH", 1500);
  const fee = await service(org.id, FEE_KEY, "Competition Entry", "FEE", 3000);
  await db.serviceCap.createMany({
    data: [
      // Door price differs from the online price — the gate charges the door one.
      { eventId: event.id, serviceTypeId: admission.id, priceCents: 2500, onsitePriceCents: 3000, capacity: 200 },
      { eventId: event.id, serviceTypeId: merch.id, priceCents: 1500, capacity: 200 },
      { eventId: event.id, serviceTypeId: fee.id, priceCents: 3000, capacity: 40 },
    ],
  });

  console.log("\n§4 the gate opens for one event");
  const active = await gate.getActiveGeneralEvent();
  check("an ACTIVE general event is resolved", active !== null && active.type === "GENERAL" && active.status === "ACTIVE",
    `${active?.code} ${active?.status}`);
  // "Newest by start time wins if more than one is somehow active" — asserted as
  // a property, so it holds whether or not this box has other active events.
  check("the newest ACTIVE general event wins",
    (active?.startsAt.getTime() ?? 0) >= startsAt.getTime(), `${active?.startsAt.toISOString()}`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§5 RE-SCAN IDEMPOTENCY — the assertion this file exists for");
  const paid = await ticket(org.id, event.id, PAID_ID, "Asha Mehta", "CONFIRMED", [
    { serviceTypeId: admission.id, description: "Dandia Entry", amountCents: 2500, status: "PAID", perAttendee: true },
  ]);
  eq("the door starts empty", await gate.getEventHeadcount(event.id), 0);

  // What the manual field actually does: expand, then resolve.
  const typed = expandTicketCode(CODE, " k7m2xq9t ");
  const view = await gate.getGateView(typed!);
  check("a typed token resolves the guest", view?.attendeeId === paid.attendeeId, String(view?.campId));
  eq("guest reads as paid", [view?.isPaid, view?.amountOwedCents], [true, 0]);
  eq("guest is not yet admitted", [view?.alreadyAdmitted, view?.admittedAt], [false, null]);

  await gate.admitAttendee(paid.attendeeId);
  eq("admitting counts one head", await gate.getEventHeadcount(event.id), 1);

  const afterAdmit = await gate.getGateView(PAID_ID);
  check("the re-scan says already admitted", afterAdmit?.alreadyAdmitted === true);
  const admittedAt = afterAdmit?.admittedAt ?? null;
  check("the re-scan reports an admit time", admittedAt !== null);

  // ── THE ROW: a second scan must not move the number the hall is read from.
  await gate.admitAttendee(paid.attendeeId);
  await gate.admitAttendee(paid.attendeeId);
  eq("A RE-SCAN DOES NOT CHANGE THE HEADCOUNT", await gate.getEventHeadcount(event.id), 1);
  const rescanned = await gate.getGateView(PAID_ID);
  eq("a re-scan does not throw, it reports",
    [rescanned?.alreadyAdmitted, rescanned?.admittedAt?.getTime()],
    [true, admittedAt?.getTime()]);
  check("the time shown is the ORIGINAL admit time, not now",
    rescanned!.admittedAt!.getTime() === admittedAt!.getTime(),
    `${rescanned?.admittedAt?.toISOString()} vs ${admittedAt?.toISOString()}`);

  // Venue time, not the reader's: the volunteer is standing at the door and will
  // compare this against the clock on the wall.
  const shown = formatVenueTime(admittedAt!);
  eq("the admit time is rendered in the venue's zone", shown,
    admittedAt!.toLocaleTimeString(undefined, { timeZone: VENUE_TIME_ZONE }));
  check("…which is not UTC", shown !== admittedAt!.toLocaleTimeString(undefined, { timeZone: "UTC" }), shown);
  const processZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (processZone === VENUE_TIME_ZONE) {
    console.log(`  ..  this box already runs in ${VENUE_TIME_ZONE} — the zone-is-pinned row can't distinguish here`);
  } else {
    check("…and not the box's own zone", shown !== admittedAt!.toLocaleTimeString(), `${processZone}`);
  }

  console.log("\n§5b an unpaid ticket is not admitted by scanning it");
  const unpaid = await ticket(org.id, event.id, UNPAID_ID, "Imran Vora", "PENDING", [
    { serviceTypeId: admission.id, description: "Dandia Entry", amountCents: 2500, status: "PENDING_PAYMENT", perAttendee: true },
  ]);
  const unpaidView = await gate.getGateView(UNPAID_ID);
  eq("will-call reads as unpaid, with the amount owed",
    [unpaidView?.isPaid, unpaidView?.amountOwedCents], [false, 2500]);
  await rejectsWith("admitting an unpaid guest is refused",
    () => gate.admitAttendee(unpaid.attendeeId), "Not paid");
  eq("a refused admission counts no head", await gate.getEventHeadcount(event.id), 1);

  console.log("\n§5c a code that isn't ours resolves to nothing, quietly");
  eq("an unknown token is null", await gate.getGateView(`${CODE}-ZZZZZZZZ`), null);
  eq("another event's ticket is null here", await gate.getGateView("GARBA-2026-ABCD1234"), null);
  eq("an empty lookup is null", await gate.getGateView(""), null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§6 will-call: handed over once, and only once");
  const withMerch = await ticket(org.id, event.id, MERCH_ID, "Ravi Kapoor", "CONFIRMED", [
    { serviceTypeId: admission.id, description: "Dandia Entry", amountCents: 2500, status: "PAID", perAttendee: true },
    // Order-level (attendeeId null) with quantity 2 — how quantity-mode merch is
    // actually stored. It must still appear under the guest who scans.
    { serviceTypeId: merch.id, description: "Dandiya Sticks", amountCents: 1500, status: "PAID", quantity: 2, perAttendee: false },
  ]);
  const merchView = await gate.getGateView(MERCH_ID);
  eq("order-level merch shows under the guest", merchView?.pickupItems.length, 1);
  eq("the quantity is on the label a volunteer reads", merchView?.pickupItems[0]?.name, "Dandiya Sticks ×2");
  eq("nothing handed over yet", merchView?.pickupItems[0]?.fulfilledAt, null);

  const pickupId = merchView!.pickupItems[0]!.lineItemId;
  await gate.fulfillLineItems([pickupId], tillMember.userId);
  const stamped = await db.lineItem.findUniqueOrThrow({ where: { id: pickupId } });
  check("hand-over is stamped", stamped.fulfilledAt !== null);
  eq("hand-over records who did it", stamped.fulfilledByUserId, tillMember.userId);

  // The re-scan case: same guest, same button, thirty seconds later.
  await gate.fulfillLineItems([pickupId], noTillMember.userId);
  const reStamped = await db.lineItem.findUniqueOrThrow({ where: { id: pickupId } });
  eq("A SECOND HAND-OVER CANNOT RE-ISSUE THE GOODS",
    [reStamped.fulfilledAt?.getTime(), reStamped.fulfilledByUserId],
    [stamped.fulfilledAt?.getTime(), stamped.fulfilledByUserId]);
  const afterPickup = await gate.getGateView(MERCH_ID);
  check("the re-scan shows it as collected", afterPickup?.pickupItems[0]?.fulfilledAt !== null);
  eq("an empty hand-over is a no-op", await gate.fulfillLineItems([], tillMember.userId), undefined);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§7 a competition FEE admits nobody");
  // The walk-up form prints "NOT A TICKET · NO FLOOR ACCESS" over the fee block
  // (4B keeps the wording, and extends it to sell-at-the-door). These rows are
  // the server meaning it.
  const catalog = await gate.getGateCatalog(event.id);
  eq("the fee is its own bucket, not admission", catalog.fees.map((f) => f.name), ["Competition Entry"]);
  eq("…and never in the admission bucket", catalog.admission.map((a) => a.name), ["Dandia Entry"]);
  eq("…nor in merch", catalog.merch.map((m) => m.name), ["Dandiya Sticks"]);
  eq("the gate menu quotes the DOOR price", catalog.admission[0]?.priceCents, 3000);

  eq("nothing admits nobody (a comp has no lines)", gate.admitsNobody([]), false);
  eq("a fee alone admits nobody", gate.admitsNobody([{ serviceType: { kind: "FEE" } }]), true);
  eq("merch alone admits nobody", gate.admitsNobody([{ serviceType: { kind: "MERCH" } }]), true);
  eq("a donation alone admits nobody", gate.admitsNobody([{ serviceType: null }]), true);
  eq("one admission line is enough",
    gate.admitsNobody([{ serviceType: { kind: "FEE" } }, { serviceType: { kind: "ADMISSION" } }]), false);

  const headBeforeFee = await gate.getEventHeadcount(event.id);
  const feeSale = await gate.sellAtGate(event.id, [fee.id], { buyerName: "Shakti Steps" });
  eq("the fee is charged at the door price", feeSale.totalCents, 3000);
  await gate.confirmGateCash(feeSale.orderId);
  eq("SELLING A FEE ISSUES NO ADMISSION", await gate.admitOrderAttendees(feeSale.orderId), 0);
  eq("SELLING A FEE DOES NOT MOVE THE HEADCOUNT", await gate.getEventHeadcount(event.id), headBeforeFee);
  const feeAttendee = await db.attendee.findFirstOrThrow({ where: { orderId: feeSale.orderId } });
  eq("the fee buyer is not checked in", feeAttendee.checkedInAt, null);
  check("the fee buyer still gets a receipt code", Boolean(feeAttendee.campId), String(feeAttendee.campId));

  // The receipt code must still RESOLVE — staff need to see what they're holding
  // — but it must not open the floor. (Handoff, screen 14: a genuine refusal.)
  const feeView = await gate.getGateView(feeAttendee.campId!);
  check("the receipt resolves at the door", feeView !== null && feeView.isPaid === true);
  await rejectsWith("but scanning it never admits", () => gate.admitAttendee(feeAttendee.id), "Not a ticket");
  eq("a refused fee scan counts no head", await gate.getEventHeadcount(event.id), headBeforeFee);

  console.log("\n§7b a walk-up that DOES buy admission still works");
  const walkUp = await gate.sellAtGate(event.id, [admission.id, fee.id], { buyerName: "Walk Up" });
  eq("both items are charged at door prices", walkUp.totalCents, 6000);
  await gate.confirmGateCash(walkUp.orderId);
  eq("a ticket-plus-fee sale admits exactly one", await gate.admitOrderAttendees(walkUp.orderId), 1);
  eq("the headcount moves by one", await gate.getEventHeadcount(event.id), headBeforeFee + 1);
  eq("re-running the sale's admission admits nobody twice", await gate.admitOrderAttendees(walkUp.orderId), 0);
  eq("…and the headcount is unmoved", await gate.getEventHeadcount(event.id), headBeforeFee + 1);

  console.log("\n§7c prices and menu come from the server, never the client");
  const other = await db.serviceType.findFirstOrThrow({
    where: { orgId: org.id, key: { notIn: [ADM_KEY, MERCH_KEY, FEE_KEY] } },
  });
  await rejectsWith("a service not offered here is refused",
    () => gate.sellAtGate(event.id, [other.id], { buyerName: "Chancer" }), "not offered at this event");
  await rejectsWith("an empty basket is refused",
    () => gate.sellAtGate(event.id, [], { buyerName: "Nobody" }), "Pick at least one item");

  await cleanup(org.id);
}

/** An org-level catalogue row, created or re-asserted. */
async function service(
  orgId: string,
  key: string,
  name: string,
  kind: "ADMISSION" | "MERCH" | "FEE",
  priceCents: number,
) {
  return db.serviceType.upsert({
    where: { orgId_key: { orgId, key } },
    update: { kind, priceCents, name },
    create: { orgId, key, name, priceCents, kind },
  });
}

type LineSpec = {
  serviceTypeId: string;
  description: string;
  amountCents: number;
  status: "PAID" | "PENDING_PAYMENT";
  quantity?: number;
  /** False = order-level (attendeeId null), how quantity-mode merch is stored. */
  perAttendee: boolean;
};

/** One order, one scannable attendee, its line items — a ticket in someone's hand. */
async function ticket(
  orgId: string,
  eventId: string,
  campId: string,
  name: string,
  status: "CONFIRMED" | "PENDING",
  lines: LineSpec[],
): Promise<{ orderId: string; attendeeId: string }> {
  const order = await db.order.create({
    data: {
      orgId,
      eventId,
      status,
      method: "STRIPE",
      registrantName: name,
      registrantEmail: `${campId.toLowerCase()}@example.test`,
      registrantPhone: "(555) 010-0000",
      attendees: { create: [{ orgId, eventId, campId, name }] },
    },
    include: { attendees: true },
  });
  const attendeeId = order.attendees[0]!.id;
  await db.lineItem.createMany({
    data: lines.map((l) => ({
      orgId,
      orderId: order.id,
      attendeeId: l.perAttendee ? attendeeId : null,
      serviceTypeId: l.serviceTypeId,
      description: l.description,
      amountCents: l.amountCents,
      quantity: l.quantity ?? 1,
      status: l.status,
    })),
  });
  return { orderId: order.id, attendeeId };
}

/** A real user + Membership row, because the till guard reads the row, not a claim. */
async function makeMember(orgId: string, email: string, role: Role, canHoldTill: boolean) {
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: `Gate verification — ${role}` },
  });
  return db.membership.upsert({
    where: { orgId_userId: { orgId, userId: user.id } },
    update: { role, canHoldTill },
    create: { orgId, userId: user.id, role, canHoldTill },
  });
}

/** The source text of one exported action, up to the next export. */
function actionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

/** Remove everything this script creates (cascades don't cover payments/ledger). */
async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({ where: { orgId, code: CODE } });
  for (const event of events) {
    const orders = await db.order.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    await db.ledgerEntry.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.event.delete({ where: { id: event.id } });
  }
  await db.serviceType.deleteMany({ where: { orgId, key: { in: [ADM_KEY, MERCH_KEY, FEE_KEY] } } });
  // Memberships cascade from the user.
  await db.user.deleteMany({ where: { email: { in: [TILL_EMAIL, NOTILL_EMAIL] } } });
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
