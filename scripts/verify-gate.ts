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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
// This must run BEFORE anything that touches src/lib/db — which is why every
// import of an app module below is a dynamic `await import`, not a top-level one.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-GATE";
// A second scratch door, so "wrong event" can be exercised for real (§5d).
const CODE2 = "VERIFY-GATE2";
// A throwaway tenant for the §4b event-resolution rows, so seeded ACTIVE
// events on the real org cannot decide the answer.
const SCRATCH_ORG_SLUG = "verify-gate-scratch";
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

/**
 * ONE place naming the action module, so moving it is a one-line edit here
 * rather than a silent structural failure. §3c reads this file as text.
 */
const GATE_ACTIONS_REL = "src/app/gate/actions.ts";
const GATE_ACTIONS_PATH = join(process.cwd(), GATE_ACTIONS_REL);

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
  const { expandTicketCode, isBareToken, tokenPrefixFor, planTicketLookup } =
    await import("../src/lib/ticketCode");
  const { generateIdToken, ID_ALPHABET, ID_TOKEN_LENGTH } = await import(
    "../src/lib/publicId"
  );
  const { normalizePublicId } = await import("../src/lib/idNormalize");
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
  console.log("\n§1b a bare token resolves at any door, a bare SEQUENCE never does");
  // A token typed with no prefix is matched by SUFFIX across events, so a guest
  // at the wrong door sees their ticket resolve instead of reading "no match".
  // Sound only for values that cannot collide.
  eq("legacy Crockford token is bare-matchable", isBareToken("K7M2XQ9T"), true);
  eq("current letters-only token is bare-matchable", isBareToken("KQMXWVPZH"), true);
  // THE ROW. prisma/seed-test.ts mints `-0001` under TWO different event codes
  // (:359 and :849), so a bare `0001` endsWith-matches two different people at
  // two different events. Without the letter test the door picks one of them.
  eq("a bare sequence is REFUSED, two events mint -0001", isBareToken("0001"), false);
  eq("digits alone are refused at any length", isBareToken("00012026"), false);
  // The floor is 8 because that is the SHORTEST TOKEN EVER MINTED (Crockford 8,
  // letters-only 9), not a uniqueness guess. It was 6, which made every surname
  // of six characters fire a cross-event scan once search and manual entry
  // shared one input.
  eq("KAPOOR is not a token", isBareToken("KAPOOR"), false);
  eq("JOHNSON is not a token", isBareToken("JOHNSON"), false);
  eq("too short to have been minted is refused", isBareToken("K7M2"), false);
  eq("a whole id is not a bare token", isBareToken("RON-2026-K7M2XQ9T"), false);

  // Predictive entry: type two characters, get every ticket whose token starts
  // with them. The CALLER anchors it to the event code, which is what makes it
  // both safe and index-eligible.
  eq("two characters is a usable prefix", tokenPrefixFor("bv"), "BV");
  eq("one character is not", tokenPrefixFor("b"), null);
  // DELIBERATELY diverges from isBareToken: a prefix is anchored to ONE event's
  // code, so the cross-event -0001 collision cannot arise and digits are fine.
  eq("a digit prefix IS usable (anchored to one event)", tokenPrefixFor("00"), "00");
  eq("a whole id is not a prefix", tokenPrefixFor("RON-2026-X"), null);
  eq("a prefix is trimmed and upper-cased", tokenPrefixFor("  bvx "), "BVX");

  eq("plan: a bare token gets both lookups", planTicketLookup("GB-2026W", "K7M2XQ9T"), {
    exact: "GB-2026W-K7M2XQ9T",
    tokenSuffix: "K7M2XQ9T",
  });
  eq("plan: a bare sequence gets NO suffix fallback", planTicketLookup("GB-2026W", "0001")?.tokenSuffix, null);
  eq("plan: but it still gets an exact lookup", planTicketLookup("GB-2026W", "0001")?.exact, "GB-2026W-0001");
  eq("plan: another event's whole id is left alone", planTicketLookup("GB-2026W", "RON-2026-K7M2XQ9T")?.exact, "RON-2026-K7M2XQ9T");
  eq("plan: empty is not a lookup", planTicketLookup("GB-2026W", "   "), null);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§1c the generator mints letters only");
  // "Only mint alpha tokens so that we don't have to go to numbers while
  // searching" -- a mixed token forces the phone keyboard between its letter
  // and number planes on every digit run, at a door, with a queue waiting.
  const draws = Array.from({ length: 1000 }, () => generateIdToken());
  eq("alphabet is 22 symbols", ID_ALPHABET.length, 22);
  eq("token length is 9", ID_TOKEN_LENGTH, 9);
  eq("every token is 9 characters", draws.every((t) => t.length === 9), true);
  // Over 1000 draws, a digit in the alphabet could not fail to appear.
  eq("NO token contains a digit", draws.some((t) => /[0-9]/.test(t)), false);
  eq("NO token contains I, L, O or U", draws.some((t) => /[ILOU]/.test(t)), false);
  eq("every character comes from ALPHABET", draws.every((t) => [...t].every((c) => ID_ALPHABET.includes(c))), true);
  // 22^9 is about 40.13 bits, holding the "40-bit token" claim that
  // src/lib/rateLimit.ts leans on to argue the token IS the access control.
  eq("the space is still at least 40 bits", Math.log2(Math.pow(ID_ALPHABET.length, ID_TOKEN_LENGTH)) >= 40, true);
  // Confusable decoding is now a NO-OP on fresh tokens (no I/L/O is emitted)
  // while staying correct for legacy ones, which is why it must stay.
  eq("normalizing a fresh token changes nothing", draws.every((t) => normalizePublicId(t) === t), true);

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
  // GUARDED. This read used to be bare, and a missing file did not fail a row —
  // it threw out of main(), so §4 through §7c never ran, no row printed for the
  // failure, cleanup() never executed (leaving scratch User/Membership rows
  // behind), and the && chain in package.json killed suites 8-15. An absent
  // file must be ONE red row, like everything else here.
  const actionsSrc = existsSync(GATE_ACTIONS_PATH)
    ? readFileSync(GATE_ACTIONS_PATH, "utf8")
    : "";
  check(
    `the gate action module is where this suite expects it (${GATE_ACTIONS_REL})`,
    actionsSrc !== "",
    "not found — move it back, or update GATE_ACTIONS_REL",
  );
  const CASH_ACTIONS = ["sellAndAdmit", "confirmUnpaidAndAdmit", "sellMerch"];
  // searchGuests is a READ returning exactly what resolveGate already returns
  // to the same roles, so it is classified OPEN. Adding it here is the
  // deliberate act this section exists to force.
  const OPEN_ACTIONS = ["resolveGate", "admit", "fulfill", "comp", "searchGuests"];
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
  // Tolerant of formatting, strict about content. The old pattern was
  // /const GATE_ROLES = \[([^\]]+)\]/, which silently yields [] — a PASSING
  // empty-vs-empty comparison is impossible only because GATE_ROLES is
  // non-empty, so it would have failed loudly; but a `satisfies Role[]`
  // annotation or a reformat would have made it fail for the wrong reason.
  // [\s\S] spans newlines; the check below proves the match happened at all.
  const rolesMatch = /const GATE_ROLES\s*=\s*\[([\s\S]*?)\]/.exec(actionsSrc);
  check("the gate's role list is still parseable from source", rolesMatch !== null);
  const rolesInSource = [...(rolesMatch?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
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

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3d ONE station, and the guards that did not move with it");
  // /gate and /checkin merged into /scan. Structural for the same reason §3c
  // is: what goes wrong is a route, a nav row and a matcher drifting apart, and
  // none of that is visible from a server function.
  const scanPage = readFileSync(join(process.cwd(), "src/app/scan/page.tsx"), "utf8");
  const navSrc = readFileSync(join(process.cwd(), "src/app/_components/staffNav.ts"), "utf8");
  const mwSrc = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

  // The page spells the roles out because a "use server" module cannot export
  // an array. This row is what stops the two copies drifting.
  const pageRoles = [...(/requireRole[(]([\s\S]*?)[)];/.exec(scanPage)?.[1] ?? "").matchAll(/"([\w]+)"/g)].map((m) => m[1]);
  eq("the scan station guards exactly the gate roles", pageRoles, GATE_ROLES);

  // staffNav rule 2: `roles` MUST mirror the server guard on the page.
  // Sliced rather than matched with one big regex: the row below is the point,
  // and a clever pattern that silently yields [] would fail for the wrong
  // reason — which is exactly the trap §3c's own role regex fell into.
  const navRowStart = navSrc.indexOf(String.raw`href: "/scan"`);
  check("the menu has a /scan row at all", navRowStart !== -1);
  const rolesStart = navSrc.indexOf("roles: [", navRowStart);
  const navRoles = [
    ...navSrc.slice(rolesStart, navSrc.indexOf("]", rolesStart)).matchAll(/"(\w+)"/g),
  ].map((m) => m[1]);
  eq("the menu row offers exactly what the page allows", navRoles, GATE_ROLES);
  check("no menu row still points at the old routes",
    !navSrc.includes(String.raw`href: "/gate"`) && !navSrc.includes(String.raw`href: "/checkin"`));
  check("POS_TILL lands on the station it can actually use", navSrc.includes(String.raw`return "/scan"`));

  // BOTH lists. Naming a path in PROTECTED while leaving it out of the matcher
  // is a silent no-op — the middleware never runs for that path at all.
  check("middleware protects /scan", mwSrc.includes(String.raw`/^\/scan(\/|$)/`));
  check("...and its matcher actually runs there", mwSrc.includes(String.raw`"/scan/:path*"`));
  // /gate was missing from BOTH until this merge, so pin it too.
  check("middleware protects /gate", mwSrc.includes(String.raw`/^\/gate(\/|$)/`));
  check("...and its matcher actually runs there", mwSrc.includes(String.raw`"/gate/:path*"`));

  // The old routes stay reachable, and must NOT re-decide access: two places
  // deciding who may open a door is how they drift apart.
  for (const old of ["gate", "checkin"]) {
    const src = readFileSync(join(process.cwd(), `src/app/${old}/page.tsx`), "utf8");
    check(`/${old} still resolves, as a redirect to /scan`, src.includes(String.raw`redirect("/scan")`));
    check(`/${old} does not keep a second copy of the guard`, !src.includes("requireRole("));
  }

  console.log("\n§4 the gate opens for one event");
  const active = await gate.getActiveGeneralEvent();
  check("an ACTIVE general event is resolved", active !== null && active.type === "GENERAL" && active.status === "ACTIVE",
    `${active?.code} ${active?.status}`);
  // "Newest by start time wins if more than one is somehow active" — asserted as
  // a property, so it holds whether or not this box has other active events.
  check("the newest ACTIVE general event wins",
    (active?.startsAt.getTime() ?? 0) >= startsAt.getTime(), `${active?.startsAt.toISOString()}`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§4b the scan station opens before doors, and never on a stale event");
  // Every row passes an explicit `now`, so these are deterministic rather than
  // dependent on whatever else is ACTIVE on the box running them.
  const { getScanStationEvent, SCAN_STATION_SETUP_HOURS } = await import("../src/server/events");
  const HOUR = 3600_000;
  // A SCRATCH ORG, not the live one. getCurrentEvent's tier 2 matches any ACTIVE
  // event with walkInOpensAt set once it has started, and the seeded MC-2027S
  // camp satisfies that forever after June 2027 — so picking a "quiet" now on
  // the real org is not hermetic, it just moves which fixture wins. Org scoping
  // is the isolation this suite already relies on everywhere else.
  const scratchOrg = await db.organization.create({
    data: { slug: SCRATCH_ORG_SLUG, name: "Verify Gate Scan Station" },
  });
  const doors = new Date(Date.now() + 3 * 24 * HOUR);
  const tonight = await db.event.create({
    data: {
      orgId: scratchOrg.id, type: "GENERAL", status: "ACTIVE", code: CODE2,
      name: "Tonight At The Door", startsAt: doors,
      endsAt: new Date(doors.getTime() + 4 * HOUR), offersRegistration: true,
    },
  });
  const at = (h: number) => ({ now: new Date(doors.getTime() + h * HOUR) });
  const orgId = scratchOrg.id;

  eq("in window: the station resolves the running event",
    (await getScanStationEvent(orgId, at(1)))?.id, tonight.id);
  // THE REQUIREMENT. getCurrentEvent cannot answer this — both its tiers need
  // startsAt <= now, and at 3:45pm for 4:30 doors it has not started.
  eq("45 minutes BEFORE doors, the station still resolves it",
    (await getScanStationEvent(orgId, at(-0.75)))?.id, tonight.id);
  eq("at the edge of the setup window it still resolves",
    (await getScanStationEvent(orgId, at(-SCAN_STATION_SETUP_HOURS + 0.01)))?.id, tonight.id);
  // …and null is a real answer, not something to paper over with a fallback.
  eq("beyond the setup window it is null, not the nearest guess",
    await getScanStationEvent(orgId, at(-SCAN_STATION_SETUP_HOURS - 1)), null);
  eq("the day before is null", await getScanStationEvent(orgId, at(-24)), null);

  // ── THE ROW THIS SECTION EXISTS FOR ──
  // This database has carried a general event still ACTIVE 160 days after it
  // ended, holding $541 (src/server/events.ts). A laxer fallback — ACTIVE and
  // startsAt <= now, newest first — hands that to a volunteer setting up, and
  // every scan afterwards resolves against the wrong event. `endsAt >= now` is
  // what refuses it.
  await db.event.update({
    where: { id: tonight.id },
    data: {
      startsAt: new Date(Date.now() - 160 * 24 * HOUR),
      endsAt: new Date(Date.now() - 159 * 24 * HOUR),
    },
  });
  eq("AN ACTIVE EVENT THAT ALREADY ENDED IS NEVER THE DOOR",
    await getScanStationEvent(orgId, { now: new Date() }), null);
  // A future ACTIVE event is the same defect facing the other way.
  await db.event.update({
    where: { id: tonight.id },
    data: {
      startsAt: new Date(Date.now() + 200 * 24 * HOUR),
      endsAt: new Date(Date.now() + 200 * 24 * HOUR + 4 * HOUR),
    },
  });
  eq("an ACTIVE event 200 days out is not tonight",
    await getScanStationEvent(orgId, { now: new Date() }), null);
  await db.event.delete({ where: { id: tonight.id } });
  await db.organization.delete({ where: { id: scratchOrg.id } });

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
  console.log("\n§5d three id shapes, one door, and the bare token that spans them");
  // THE REGRESSION THIS SECTION EXISTS FOR: the alphabet changed, but ids
  // already minted kept the characters they were minted with. On any given
  // night a door resolves all three shapes at once, and all three must work.
  const legacyId = `${CODE}-0007`;         // legacy per-event sequence
  const alphaId = `${CODE}-KQMXWVPZH`;     // letters-only, 9
  const adm: LineSpec[] = [
    { serviceTypeId: admission.id, description: "Dandia Entry", amountCents: 2500, status: "PAID", perAttendee: true },
  ];
  await ticket(org.id, event.id, legacyId, "Legacy Sequence", "CONFIRMED", adm);
  const alphaTicket = await ticket(org.id, event.id, alphaId, "Alpha Nine", "CONFIRMED", adm);
  for (const [shape, id] of [
    ["legacy sequential", legacyId],
    ["Crockford base32", PAID_ID],
    ["letters-only", alphaId],
  ] as const) {
    eq(`a ${shape} id still resolves at the door`, (await gate.getGateView(id))?.campId, id);
  }

  // The prefix is fixed text on screen, so only the token is typed.
  eq("a bare Crockford token resolves with no prefix", (await gate.getGateView("K7M2XQ9T", CODE))?.campId, PAID_ID);
  eq("a bare letters-only token resolves with no prefix", (await gate.getGateView("KQMXWVPZH", CODE))?.campId, alphaId);
  eq("a bare sequence resolves by PREFIX, not by suffix", (await gate.getGateView("0007", CODE))?.campId, legacyId);
  // End to end, not just as a pure function (§1 pins that): someone reading
  // `0007` off a printed badge and typing the letter O must still land on the
  // ticket. This is the whole reason applyConfusables cannot be deleted now
  // that the generator no longer emits O — legacy ids are still in inboxes.
  eq("a typed O resolves a legacy zero", (await gate.getGateView("OOO7", CODE))?.campId, legacyId);
  eq("a code that matches nothing is still null", await gate.getGateView("K7M2XQ90", CODE), null);

  // A SECOND door, so "wrong event" is a real state rather than a hypothetical.
  const event2 = await db.event.create({
    data: {
      orgId: org.id, type: "GENERAL", status: "ACTIVE", code: CODE2,
      name: "The Other Door", startsAt, endsAt: new Date(startsAt.getTime() + 3600_000),
      offersRegistration: true,
    },
  });

  // The whole point of matching a bare token ACROSS events: a guest at the
  // wrong door must see their ticket resolve, naming the event it belongs to,
  // instead of reading "no match" and being waved into the wrong queue.
  const atWrongDoor = await gate.getGateView("K7M2XQ9T", CODE2);
  check("a bare token from another event still RESOLVES at this door", atWrongDoor?.attendeeId === paid.attendeeId);
  eq("…and it names the event it actually belongs to", atWrongDoor?.eventName, event.name);
  check("…and the screen can tell it apart from this door", atWrongDoor?.eventId !== event2.id);

  // …but resolving is not admitting. BEFORE the already-admitted early return:
  // `paid` was admitted back in §5, and this must still refuse rather than
  // reassure with "already in".
  await rejectsWith("a ticket from another event is REFUSED admission", () => gate.admitAttendee(paid.attendeeId, event2.id), "Wrong event");
  eq("a refused cross-event admit moves no headcount", await gate.getEventHeadcount(event2.id), 0);
  await rejectsWith("…even for a guest who was never admitted anywhere", () => gate.admitAttendee(alphaTicket.attendeeId, event2.id), "Wrong event");
  // The same call at the RIGHT door still works, so the guard is not a blanket refusal.
  await gate.admitAttendee(alphaTicket.attendeeId, event.id);
  eq("the same ticket admits at its own door", await gate.getEventHeadcount(event.id), 2);

  // Two ids sharing a tail: refuse, never guess. isBareToken makes this
  // vanishingly unlikely; "the door silently picked one of two people" is not a
  // state worth leaving reachable on an access path.
  await ticket(org.id, event.id, `${CODE}-QQQQQQQQ`, "Tail One", "CONFIRMED", adm);
  await ticket(org.id, event.id, `ZZOTHER-QQQQQQQQ`, "Tail Two", "CONFIRMED", adm);
  await rejectsWith("two ids sharing a tail are refused, not guessed", () => gate.getGateView("QQQQQQQQ", CODE2), "more than one ticket");

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
  const feeSale = await gate.sellAtGate(event.id, [{ serviceTypeId: fee.id, quantity: 1 }], { buyerName: "Shakti Steps" });
  eq("the fee is charged at the door price", feeSale.totalCents, 3000);
  await gate.confirmGateCash(feeSale.orderId);
  // Reads .admitted rather than a bare number now that admitOrderAttendees
  // reports both halves. SAME expected value, read more precisely, plus a
  // companion for the half it could not express before.
  eq("SELLING A FEE ISSUES NO ADMISSION", (await gate.admitOrderAttendees(feeSale.orderId)).admitted, 0);
  eq("...and it did not quietly count them as already in", (await gate.admitOrderAttendees(feeSale.orderId)).already, 0);
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
  const walkUp = await gate.sellAtGate(event.id, [{ serviceTypeId: admission.id, quantity: 1 }, { serviceTypeId: fee.id, quantity: 1 }], { buyerName: "Walk Up" });
  eq("both items are charged at door prices", walkUp.totalCents, 6000);
  await gate.confirmGateCash(walkUp.orderId);
  eq("a ticket-plus-fee sale admits exactly one", (await gate.admitOrderAttendees(walkUp.orderId)).admitted, 1);
  eq("the headcount moves by one", await gate.getEventHeadcount(event.id), headBeforeFee + 1);
  eq("re-running the sale's admission admits nobody twice", (await gate.admitOrderAttendees(walkUp.orderId)).admitted, 0);
  // THE HALF THAT WAS INVISIBLE: a bare 0 could not distinguish "nobody was
  // eligible" from "they were all already in". At a door those mean different
  // numbers of wristbands.
  eq("...and reports that they were already in", (await gate.admitOrderAttendees(walkUp.orderId)).already, 1);
  eq("…and the headcount is unmoved", await gate.getEventHeadcount(event.id), headBeforeFee + 1);
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§8 a guest who cannot be scanned can still be found");
  // "Allow search and checkin" / "we shoudl be able to also serach by
  // name/email AND CHECKIN". Same GateView a scan produces, so a tapped result
  // flows into the identical verdict and the identical admit path.
  const hits = (q: string) => gate.searchGateGuests(event.id, q, CODE);

  eq("a single character is a browse, not a lookup", (await hits("A")).length, 0);
  const byName = await hits("Asha");
  eq("a guest is found by first name", byName[0]?.attendeeId, paid.attendeeId);
  eq("...case-insensitively", (await hits("asha"))[0]?.attendeeId, paid.attendeeId);
  eq("...and by surname, not just a prefix of the whole name",
    (await hits("Mehta"))[0]?.attendeeId, paid.attendeeId);
  eq("a guest is found by a fragment of their code",
    (await hits("K7M2"))[0]?.attendeeId, paid.attendeeId);

  // PREDICTIVE ENTRY. "BV should bring in any tokens starting with BV so the
  // gate doesnt have to type whole."
  await ticket(org.id, event.id, `${CODE}-BVAAAAAAA`, "Bee Vee One", "CONFIRMED", adm);
  await ticket(org.id, event.id, `${CODE}-BVBBBBBBB`, "Bee Vee Two", "CONFIRMED", adm);
  const bvHits = await hits("BV");
  eq("two characters bring back every token starting with them",
    bvHits.filter((h) => h.campId?.startsWith(`${CODE}-BV`)).length, 2);
  // Anchored to THIS event's code, so a fragment cannot match inside the
  // prefix every ticket already shares.
  // THE ROW THE ANCHOR EXISTS FOR. Every campId contains the event code, so an
  // unanchored code search turns a fragment of it into a full roster dump.
  // "GATE" is inside every campId this suite mints (VERIFY-GATE-...), and
  // unlike "VERIF" it survives the confusable mapping intact -- I would become
  // 1 and match nothing either way, which is how this row first passed against
  // a broken implementation.
  // Every campId this suite mints contains "GATE" (VERIFY-GATE-...), so an
  // UNANCHORED code clause turns that fragment into a whole-roster dump. Rows
  // legitimately matched by NAME are excluded -- walk-up orders are literally
  // called "Gate sale", and finding those is correct. What must be zero is rows
  // that came back only because the event code happens to contain the letters.
  const gateHits = await hits("GATE");
  eq("a fragment of the EVENT CODE matches no CODES",
    gateHits.filter((h) => !(h.name ?? "").toUpperCase().includes("GATE")).length, 0);
  // ...while a pasted whole id still resolves through search.
  eq("a pasted whole id is still found",
    (await hits(PAID_ID))[0]?.attendeeId, paid.attendeeId);
  check("a code match sorts above a name match",
    (await hits("BV"))[0]?.campId?.startsWith(`${CODE}-BV`) === true);

  // THE ROW SEARCH EXISTS FOR. Attendees are created at cart creation but
  // campIds only at confirmOrderPaid, so a will-call guest on an unpaid order
  // has campId NULL -- getGateView matches on campId and can NEVER find them.
  // Search by name is the only way those people get through a door.
  const noCode = await db.order.create({
    data: {
      orgId: org.id, eventId: event.id, status: "PENDING", method: "STRIPE",
      registrantName: "Nocode Nirmala", registrantEmail: "nirmala@example.test",
      registrantPhone: "555-0100",
      attendees: { create: [{ orgId: org.id, eventId: event.id, name: "Nocode Nirmala" }] },
    },
    include: { attendees: true },
  });
  const found = await hits("Nirmala");
  eq("AN UNPAID GUEST WITH NO CODE AT ALL IS STILL FINDABLE", found.length, 1);
  eq("...and has no code to have been scanned by", found[0]?.campId, null);
  eq("...and reads as unpaid", found[0]?.isPaid, false);
  eq("a guest is findable by the email on their order",
    (await hits("nirmala@example.test"))[0]?.attendeeId, noCode.attendees[0].id);

  // Event-scoped, unlike a code lookup. A NAME has no way to say which event.
  const otherOrg = await hits("Nirmala");
  eq("search never leaves the event being staffed",
    otherOrg.every((h) => h.eventId === event.id), true);
  check("a result set is capped", (await hits("e")).length <= gate.GATE_SEARCH_LIMIT);
  // Every walk-up cash sale is recorded against gate@gate.local, so an
  // unfiltered email clause turns "gate" into every walk-up in the building.
  eq("the walk-up sentinel address is not searchable",
    (await hits("gate@gate.local")).length, 0);
  // ...but a walk-up whose buyer name was actually typed is still findable,
  // which is the case that matters at a door.
  await gate.sellAtGate(event.id, [{ serviceTypeId: admission.id, quantity: 1 }], { buyerName: "Findable Walkup" });
  check("a named walk-up is still findable by that name",
    (await hits("Findable")).length >= 1);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§8b one scan resolves the whole party");
  // "present total ticetks under one scan and ask for checking in all of them."
  const famOrder = await db.order.create({
    data: {
      orgId: org.id, eventId: event.id, status: "CONFIRMED", method: "CASH",
      registrantName: "Family Of Three", registrantEmail: "fam@example.test",
      registrantPhone: "555-0101",
      attendees: {
        create: [
          { orgId: org.id, eventId: event.id, name: "Fam One", campId: `${CODE}-FAMAAAAAA` },
          { orgId: org.id, eventId: event.id, name: "Fam Two", campId: `${CODE}-FAMBBBBBB` },
          { orgId: org.id, eventId: event.id, name: "Fam Three", campId: `${CODE}-FAMCCCCCC` },
        ],
      },
      lineItems: {
        create: [{
          orgId: org.id, serviceTypeId: admission.id, description: "Family entry",
          amountCents: 7500, quantity: 3, status: "PAID",
        }],
      },
    },
    include: { attendees: true },
  });

  const famView = await gate.getGateView(`${CODE}-FAMAAAAAA`);
  eq("scanning one code shows all three tickets", famView?.party.length, 3);
  eq("...and flags which one was actually presented",
    famView?.party.filter((t) => t.scanned).map((t) => t.campId), [`${CODE}-FAMAAAAAA`]);
  eq("...none of them admitted yet",
    famView?.party.every((t) => !t.alreadyAdmitted), true);

  const headBeforeFam = await gate.getEventHeadcount(event.id);
  // Admit two of the three individually, to build the partial case.
  await gate.admitAttendee(famOrder.attendees[0].id, event.id);
  await gate.admitAttendee(famOrder.attendees[1].id, event.id);
  eq("individual admits move the headcount one at a time",
    await gate.getEventHeadcount(event.id), headBeforeFam + 2);

  // THE PARTIAL CASE. Admitting the order again must report ONE new and TWO
  // already in -- at a door those are different numbers of wristbands.
  const partial = await gate.admitOrderAttendees(famOrder.id, event.id);
  eq("ADMIT ALL REPORTS BOTH HALVES, NOT A TOTAL", partial, { admitted: 1, already: 2 });
  eq("...and only the new one moved the headcount",
    await gate.getEventHeadcount(event.id), headBeforeFam + 3);
  const again = await gate.admitOrderAttendees(famOrder.id, event.id);
  eq("running it once more admits nobody", again, { admitted: 0, already: 3 });
  eq("...and the headcount is unmoved",
    await gate.getEventHeadcount(event.id), headBeforeFam + 3);

  eq("a party admit refuses a ticket from another event",
    (await gate.getGateView(`${CODE}-FAMAAAAAA`))?.party.length, 3);
  await rejectsWith("...and the guard still fires per attendee",
    () => gate.admitOrderAttendees(famOrder.id, event2.id), "Wrong event");


  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§8c a walk-up buys for the whole family");
  // "Add more then one cash e purchase. Right now it is only one at a time."
  // The UI held selections in a Set, which cannot contain a duplicate -- and
  // sellAtGate hard-coded ONE attendee, so even with a quantity the sale would
  // have charged for three, decremented capacity by three, and minted one code.
  const mint = await import("../src/lib/ticketMinting");

  // The pure rules first, so a failure says which half broke.
  eq("duplicate lines merge", mint.normalizeGateBasket([
    { serviceTypeId: "a", quantity: 1 },
    { serviceTypeId: "a", quantity: 2 },
  ]), [{ serviceTypeId: "a", quantity: 3 }]);
  eq("a zero quantity is not a line",
    mint.normalizeGateBasket([{ serviceTypeId: "a", quantity: 0 }]), []);
  eq("a negative quantity is not a line",
    mint.normalizeGateBasket([{ serviceTypeId: "a", quantity: -4 }]), []);
  eq("a fat-fingered quantity is clamped", mint.normalizeGateBasket([
    { serviceTypeId: "a", quantity: 999 },
  ]), [{ serviceTypeId: "a", quantity: mint.GATE_MAX_QTY_PER_LINE }]);
  eq("a fraction is floored",
    mint.normalizeGateBasket([{ serviceTypeId: "a", quantity: 2.7 }])[0]?.quantity, 2);

  eq("a fee alone still mints ONE receipt, not zero",
    mint.ticketCountFor([{ kind: "FEE", quantity: 1, admitsCount: 1 }]), 1);
  eq("merch alone likewise",
    mint.ticketCountFor([{ kind: "MERCH", quantity: 5, admitsCount: 1 }]), 1);
  eq("three admissions mint three",
    mint.ticketCountFor([{ kind: "ADMISSION", quantity: 3, admitsCount: 1 }]), 3);
  // A "family of 4" chip bought twice is EIGHT people, which the gate could
  // never express before.
  eq("admitsCount multiplies",
    mint.ticketCountFor([{ kind: "ADMISSION", quantity: 2, admitsCount: 4 }]), 8);
  eq("a fee riding along with admissions does not add a ticket",
    mint.ticketCountFor([
      { kind: "ADMISSION", quantity: 2, admitsCount: 1 },
      { kind: "FEE", quantity: 1, admitsCount: 1 },
    ]), 2);

  // End to end at the door.
  const headBeforeQty = await gate.getEventHeadcount(event.id);
  const family = await gate.sellAtGate(event.id, [
    { serviceTypeId: admission.id, quantity: 3 },
    { serviceTypeId: merch.id, quantity: 2 },
  ], { buyerName: "Quantity Family" });
  // 3 x 3000 door admission + 2 x 1500 door merch
  eq("every line is charged for its quantity", family.totalCents, 12000);
  eq("THREE ADMISSIONS MINT THREE CODES", family.ticketCount, 3);

  const famLines = await db.lineItem.findMany({ where: { orderId: family.orderId } });
  eq("merch is ONE row with quantity 2, not two rows",
    famLines.filter((l) => l.quantity === 2).length, 1);
  eq("...and the basket is two lines in total", famLines.length, 2);

  const soldBefore = (await db.serviceCap.findFirstOrThrow({
    where: { eventId: event.id, serviceTypeId: admission.id },
  })).sold;
  await gate.confirmGateCash(family.orderId);
  const soldAfter = (await db.serviceCap.findFirstOrThrow({
    where: { eventId: event.id, serviceTypeId: admission.id },
  })).sold;
  eq("capacity is consumed per PERSON, not per sale", soldAfter - soldBefore, 3);

  const famAttendees = await db.attendee.findMany({
    where: { orderId: family.orderId }, select: { campId: true },
  });
  eq("three distinct codes exist", new Set(famAttendees.map((a) => a.campId)).size, 3);
  check("...and every one of them was actually minted",
    famAttendees.every((a) => a.campId !== null));

  eq("admitting the order puts three people through",
    await gate.admitOrderAttendees(family.orderId, event.id), { admitted: 3, already: 0 });
  eq("...and the headcount moved by three",
    await gate.getEventHeadcount(event.id), headBeforeQty + 3);

  // Every ticket on the order reads the same money, because the lines are
  // order-level rather than pinned to attendee #1.
  const famViews = await Promise.all(
    famAttendees.map((a) => gate.getGateView(a.campId!)),
  );
  eq("every ticket in the party reads the same amount owed",
    new Set(famViews.map((v) => v?.amountOwedCents)).size, 1);
  eq("...and each one sees all three tickets",
    famViews.every((v) => v?.party.length === 3), true);

  // The menu now says how much room is left, so a volunteer can see the cliff
  // BEFORE taking cash for more than exists.
  const cat = await gate.getGateCatalog(event.id);
  check("the menu reports remaining headroom",
    cat.admission.every((a) => a.remaining === null || a.remaining >= 0));
  // The screen has to say how many PEOPLE a basket admits, and three admissions
  // plus two dandiya sticks is five ITEMS and three people. Caught driving the
  // real UI: the button read "admit 5" while the server correctly admitted 3.
  // admitsCount is why a "family of 4" chip counts four rather than one.
  check("the menu carries admitsCount, so the screen can count people",
    cat.admission.every((a) => typeof a.admitsCount === "number" && a.admitsCount >= 1));
  const gm = readFileSync(join(process.cwd(), "src/app/scan/GateMode.tsx"), "utf8");
  check("the cash button counts admissions, not basket lines",
    gm.includes("admitsCountFor(catalog.admission") && !/admit \{basketCount\(/.test(gm));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§8d a reserved address is never sent to");
  const mail = await import("../src/lib/emailAddress");
  // Every walk-up is recorded against gate@gate.local. `.local` (RFC 6762) and
  // `.invalid` (RFC 6761) never resolve, so each send is a silent HARD BOUNCE
  // -- and SES suspends an account over 5%.
  eq("the walk-up sentinel is undeliverable",
    mail.isUndeliverableAddress("gate@gate.local"), true);
  eq("so is the membership sentinel",
    mail.isUndeliverableAddress("someone@dcica.invalid"), true);
  eq("a real address is deliverable",
    mail.isUndeliverableAddress("asha@example.com"), false);
  // NOT .test or .example: the verify suites and manual QA use those on
  // purpose, and silently swallowing one would be a nastier surprise.
  eq("a .test address is still sent (QA uses them deliberately)",
    mail.isUndeliverableAddress("asha@example.test"), false);
  eq("case does not matter", mail.isUndeliverableAddress("Gate@GATE.LOCAL"), true);
  eq("a non-address is not undeliverable", mail.isUndeliverableAddress("nonsense"), false);
  const emailSrc = readFileSync(join(process.cwd(), "src/lib/email.ts"), "utf8");
  check("the guard sits at the one chokepoint every send passes",
    emailSrc.includes("isUndeliverableAddress(to)"));



  console.log("\n§9 prices and menu come from the server, never the client");
  const other = await db.serviceType.findFirstOrThrow({
    where: { orgId: org.id, key: { notIn: [ADM_KEY, MERCH_KEY, FEE_KEY] } },
  });
  await rejectsWith("a service not offered here is refused",
    () => gate.sellAtGate(event.id, [{ serviceTypeId: other.id, quantity: 1 }], { buyerName: "Chancer" }), "not offered at this event");
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
      // NOT derived from the campId. It used to be, and that quietly made the
        // code-search rows meaningless: every order email then contained the
        // event code, so searching a fragment of it matched everything by
        // EMAIL and no code clause could be observed. A real buyer email has
        // nothing to do with their ticket id.
      registrantEmail: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`,
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
  const events = await db.event.findMany({ where: { orgId, code: { in: [CODE, CODE2] } } });
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
  await db.event.deleteMany({ where: { org: { slug: SCRATCH_ORG_SLUG } } });
  await db.organization.deleteMany({ where: { slug: SCRATCH_ORG_SLUG } });
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
