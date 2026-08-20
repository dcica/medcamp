/**
 * Negative-path regression check — bad form entries, run against scratch events,
 * then clean up.
 *
 *   ENV_FILE=.env npx tsx scripts/verify-validation.ts
 *
 * Sibling of verify-pricing.ts, which covers the money path on GOOD input. This
 * one covers the other half: what happens when the input is wrong. Three layers
 * are in scope, because they fail differently and one buyer can meet all three:
 *
 *   1. `registrationSchema` (zod)      — shape/type failures, before any query.
 *   2. `createRegistration` (business) — rules only the database can settle: is
 *      this event selling, is this service offered HERE, does this plan exist.
 *   3. `submitRegistration` (action)   — what the red box on the form actually
 *      SAYS. A rejection that leaks a stack trace is still a defect even though
 *      the order was correctly refused, so the message text is asserted too.
 *
 * Layer 3 matters more than it looks. Every case below is reachable by a
 * hand-rolled POST, not only through the form: the browser-side checks are a
 * courtesy and `RegisterForm.tsx:191` says so outright ("Its rules are looser
 * than registrationSchema's on purpose"). The server is the only real gate, so
 * these rows are what pin it.
 *
 * On asserting message strings — where the app AUTHORS the wording (a custom
 * `message:` in the schema, or a thrown `new Error("...")`) the exact string is
 * asserted, because that is buyer-facing copy the app owns and a silent reword
 * is worth catching. Where ZOD authors the wording (`min`, `int`) the issue PATH
 * is asserted instead of the English, because that phrasing belongs to the
 * library: hardcoding a copy of it would turn this script red on a zod upgrade
 * without anything actually being broken.
 *
 * ── THIS FILE IS EXPECTED TO EXIT 1 AS WRITTEN ──
 * Four rows are red on purpose, against two defects found while writing it. Each
 * asserts the behaviour that SHOULD hold rather than the behaviour observed, so
 * the suite reports the gap instead of enshrining it:
 *
 *   §8 (1 row) — a nonexistent eventId returns a raw Prisma dump, absolute
 *                server path and source snippet included, to the buyer.
 *   §9 (3 rows) — whitespace-only name/phone satisfy min(), so a blank-looking
 *                name and an unreachable phone both pass validation.
 *
 * Both are commented in place with the fix. Green means both are fixed — do not
 * make this file green by softening a row. (Both WERE fixed, so the suite exits
 * 0 as of task G9 — the note above is kept for the rule it states.)
 *
 * §10–§13 extend the same idea to the VOLUNTEER signup schema: the counselor
 * name+email pair (all-or-nothing, because a name alone cannot be stored), the
 * school's hours-approval link (https-only), and the client-is-never-stricter
 * invariant asserted as a property over a sample table rather than by review.
 */
import type { RegistrationInput } from "../src/server/registration";
import type { SubmitResult } from "../src/app/register/actions";
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// The machine has a global DATABASE_URL pointing at an unrelated project; dotenv
// will not override an already-set shell var without this. Do not remove.
dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();

const CODE = "VERIFY-VALID";
const CAMP_CODE = "VERIFY-VALID-CAMP";
const CLOSED_CODE = "VERIFY-VALID-CLOSED";
const EMAIL = "verify-validation@example.test";
/** Every service key this script creates. Must match cleanup() exactly. */
const KEYS = ["vv-admission", "vv-merch", "vv-consult", "vv-camp-only"];
const PLAN_KEY = "vv-retired-plan";

let failures = 0;

/** Set in main() after dotenv has run — the modules under test read env on import. */
let submit: (input: RegistrationInput) => Promise<SubmitResult>;
let parse: (input: unknown) => { ok: true } | { ok: false; paths: string[]; messages: string[] };

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  PASS" : "  FAIL"}  ${label}` +
      (ok ? "" : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

/**
 * The input is deliberately malformed, so it cannot satisfy RegistrationInput.
 * One cast, here, instead of one at every call site.
 */
function bad(input: Record<string, unknown>): RegistrationInput {
  return input as unknown as RegistrationInput;
}

/**
 * Assert the form refuses this input AND says exactly this to the buyer. Goes
 * through the action, not createRegistration, so the assertion covers the
 * error-to-copy translation (`toBuyerMessage`) rather than the raw throw.
 *
 * An ACCEPTED input is reported as the failure it is — silently passing when a
 * bad input was let through is the one outcome this whole file exists to catch.
 */
async function refuses(
  label: string,
  input: Record<string, unknown>,
  expected: string,
): Promise<void> {
  const r = await submit(bad(input));
  if (r.ok) {
    check(
      label,
      `ACCEPTED — created an order and redirected to ${r.redirectUrl}`,
      `refused with: ${expected}`,
    );
    return;
  }
  check(label, r.error, expected);
}

/**
 * For zod's own wording: assert WHICH fields were faulted, not what English zod
 * chose. Sorted because issue order is not part of the contract.
 */
function faultsFields(
  label: string,
  input: Record<string, unknown>,
  expectedPaths: string[],
): void {
  const r = parse(input);
  check(label, r.ok ? "PARSED — no fault raised" : r.paths, expectedPaths.slice().sort());
}

/**
 * A refusal is not allowed to hand the buyer server internals. Checked as a
 * property of the string rather than an equality assertion so it holds for
 * messages this file never enumerated.
 */
function leaksNoInternals(label: string, message: string): void {
  const smells = [
    "prisma",
    "findUnique",
    "findFirst",
    "invocation",
    "node_modules",
    "/src/",
    ".ts:",
    "at async",
    "PrismaClient",
  ];
  const hit = smells.filter((s) => message.toLowerCase().includes(s.toLowerCase()));
  const verdict =
    hit.length > 0
      ? `leaks ${JSON.stringify(hit)}`
      : message.length > 200
        ? `${message.length} chars — too long to be copy`
        : message.includes("\n")
          ? "contains newlines — not a single sentence"
          : "clean";
  check(label, verdict, "clean");
}

async function main(): Promise<void> {
  const registration = await import("../src/server/registration");
  const actions = await import("../src/app/register/actions");
  submit = actions.submitRegistration;
  parse = (input: unknown) => {
    const r = registration.registrationSchema.safeParse(input);
    if (r.success) return { ok: true };
    return {
      ok: false,
      paths: r.error.issues.map((i) => i.path.join(".")).sort(),
      messages: [...new Set(r.error.issues.map((i) => i.message))],
    };
  };

  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  // Relative to now, never a literal date: isRegistrationOpen refuses a finished
  // event, so a hardcoded endsAt would turn this script red the day it passed.
  const soon = new Date(Date.now() + 30 * 24 * 3600_000);
  const soonEnd = new Date(soon.getTime() + 4 * 3600_000);

  // Quantity mode — the dandiya shape. Most cases live here.
  const event = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "OPEN",
      code: CODE,
      name: "Validation Verification",
      startsAt: soon,
      endsAt: soonEnd,
      collectsAttendeeDetails: false,
      honorsMembership: true,
    },
  });
  // Attendee mode — the camp shape. Needed because the empty-cart rule is a
  // DIFFERENT message on each side of collectsAttendeeDetails.
  const camp = await db.event.create({
    data: {
      orgId: org.id,
      type: "CAMP",
      status: "OPEN",
      code: CAMP_CODE,
      name: "Validation Verification (camp)",
      startsAt: soon,
      endsAt: soonEnd,
      collectsAttendeeDetails: true,
      honorsMembership: false,
    },
  });
  // A sellable event that a coordinator has closed. Its endsAt is in the FUTURE
  // so nothing but the status can be doing the refusing.
  const closed = await db.event.create({
    data: {
      orgId: org.id,
      type: "GENERAL",
      status: "CLOSED",
      code: CLOSED_CODE,
      name: "Validation Verification (closed)",
      startsAt: soon,
      endsAt: soonEnd,
      collectsAttendeeDetails: false,
      honorsMembership: false,
    },
  });

  const admission = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "vv-admission" } },
    update: { fulfillable: false, admits: true, priceCents: 1500 },
    create: {
      orgId: org.id,
      key: "vv-admission",
      name: "VV Admission",
      priceCents: 1500,
      fulfillable: false,
      admits: true,
    },
  });
  const merch = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "vv-merch" } },
    update: { fulfillable: true, admits: false, priceCents: 500 },
    create: {
      orgId: org.id,
      key: "vv-merch",
      name: "VV Merch",
      priceCents: 500,
      fulfillable: true,
      admits: false,
    },
  });
  const consult = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "vv-consult" } },
    update: { fulfillable: false, admits: true, priceCents: 2000 },
    create: {
      orgId: org.id,
      key: "vv-consult",
      name: "VV Consult",
      priceCents: 2000,
      fulfillable: false,
      admits: true,
    },
  });
  // Exists in the org's catalogue and is active, but is offered at the CAMP
  // only. This is the realistic version of "unknown service": not a typo, a
  // real key from a real menu, aimed at the wrong event.
  const campOnly = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: "vv-camp-only" } },
    update: { fulfillable: false, admits: false, priceCents: 4000 },
    create: {
      orgId: org.id,
      key: "vv-camp-only",
      name: "VV Camp Only",
      priceCents: 4000,
      fulfillable: false,
      admits: false,
    },
  });

  for (const s of [admission, merch]) {
    await db.serviceCap.create({
      data: {
        eventId: event.id,
        serviceTypeId: s.id,
        priceCents: s.priceCents,
        capacity: 1000,
      },
    });
  }
  for (const s of [consult, campOnly]) {
    await db.serviceCap.create({
      data: {
        eventId: camp.id,
        serviceTypeId: s.id,
        priceCents: s.priceCents,
        capacity: 1000,
      },
    });
  }
  await db.serviceCap.create({
    data: {
      eventId: closed.id,
      serviceTypeId: admission.id,
      priceCents: 1500,
      capacity: 1000,
    },
  });

  // Deactivated, not deleted — the shape a retired plan actually leaves behind.
  // createRegistration filters on `active: true`, and nothing pinned that.
  const retired = await db.membershipPlan.upsert({
    where: { orgId_key: { orgId: org.id, key: PLAN_KEY } },
    update: { partySize: 4, priceCents: 5000, termYears: 1, active: false },
    create: {
      orgId: org.id,
      key: PLAN_KEY,
      name: "VV Retired Plan",
      termYears: 1,
      priceCents: 5000,
      partySize: 4,
      active: false,
    },
  });

  const who = { name: "Verify Buyer", email: EMAIL, phone: "555-0100" };
  const oneTicket = [{ serviceKey: "vv-admission", quantity: 1 }];
  /** A valid order on the quantity event, for mutating one field at a time. */
  const okOrder = {
    eventId: event.id,
    registrant: who,
    marketingConsent: false,
    quantities: oneTicket,
  };

  // ── 1. Contact details, where the app authors the wording ──
  // These strings land in the red box verbatim, so they are asserted verbatim. A
  // blank name is the single most common bad entry on a phone — autofill fires
  // on email and phone and misses the name.
  //
  // An EMPTY name is refused here; a whitespace-only one is not. That is not an
  // omission in this section, it is section 9.
  console.log("\n1. Registrant contact details");
  await refuses(
    "blank name is refused",
    { ...okOrder, registrant: { ...who, name: "" } },
    "Name is required.",
  );
  await refuses(
    "email without an @ is refused",
    { ...okOrder, registrant: { ...who, email: "nope" } },
    "Valid email required.",
  );
  await refuses(
    "email with an @ but no domain is refused",
    { ...okOrder, registrant: { ...who, email: "a@" } },
    "Valid email required.",
  );
  await refuses(
    "a 3-digit phone is refused",
    { ...okOrder, registrant: { ...who, phone: "123" } },
    "Phone is required.",
  );
  // All three wrong at once. The buyer must get ONE line naming all three, not
  // the first fault alone — a form that reveals its problems one reload at a
  // time is how a walk-in queue backs up.
  await refuses(
    "three bad fields produce one combined line, not just the first fault",
    { ...okOrder, registrant: { name: "", email: "nope", phone: "1" } },
    "Please check your details: Name is required; Valid email required; Phone is required.",
  );

  // ── 2. Numbers, where zod owns the wording ──
  // Paths, not English. See the header note.
  console.log("\n2. Numeric fields refuse nonsense");
  faultsFields(
    "a negative quantity faults that quantity row",
    { ...okOrder, quantities: [{ serviceKey: "vv-admission", quantity: -2 }] },
    ["quantities.0.quantity"],
  );
  faultsFields(
    "a fractional quantity faults that quantity row",
    { ...okOrder, quantities: [{ serviceKey: "vv-admission", quantity: 1.5 }] },
    ["quantities.0.quantity"],
  );
  faultsFields(
    "a negative donation faults donationCents",
    { ...okOrder, donationCents: -500 },
    ["donationCents"],
  );
  faultsFields(
    "a fractional donation faults donationCents — cents are indivisible",
    { ...okOrder, donationCents: 12.5 },
    ["donationCents"],
  );
  faultsFields(
    "a quantity sent as a string faults that quantity row",
    { ...okOrder, quantities: [{ serviceKey: "vv-admission", quantity: "2" }] },
    ["quantities.0.quantity"],
  );
  // Both halves of one row wrong: the key blank AND the count negative. Two
  // faults, two paths — proves the schema does not stop at the first.
  faultsFields(
    "a row with a blank key and a negative count faults both",
    { ...okOrder, quantities: [{ serviceKey: "", quantity: -1 }] },
    ["quantities.0.serviceKey", "quantities.0.quantity"],
  );

  // ── 3. An empty cart, which reads differently per registration mode ──
  console.log("\n3. An empty cart is refused in both modes");
  await refuses("quantity mode, nothing picked", { ...okOrder, quantities: [] }, "Pick at least one item.");
  await refuses(
    "quantity mode, everything set to zero",
    { ...okOrder, quantities: [{ serviceKey: "vv-admission", quantity: 0 }] },
    "Pick at least one item.",
  );
  await refuses(
    "quantity mode, quantities key absent entirely",
    { eventId: event.id, registrant: who, marketingConsent: false },
    "Pick at least one item.",
  );
  await refuses(
    "attendee mode, no attendee rows",
    { eventId: camp.id, registrant: who, marketingConsent: false, attendees: [] },
    "Add at least one attendee.",
  );
  // An attendee-mode event handed quantities instead of attendees must not
  // silently sell anything down the wrong branch.
  await refuses(
    "attendee mode, sent quantities instead of attendees",
    {
      eventId: camp.id,
      registrant: who,
      marketingConsent: false,
      quantities: [{ serviceKey: "vv-consult", quantity: 1 }],
    },
    "Add at least one attendee.",
  );

  // ── 4. Attendee rows, where the app authors the wording ──
  console.log("\n4. Attendee rows must be complete");
  await refuses(
    "an attendee with no name is refused",
    {
      eventId: camp.id,
      registrant: who,
      marketingConsent: false,
      attendees: [{ name: "", serviceKeys: ["vv-consult"] }],
    },
    "Attendee name is required.",
  );
  await refuses(
    "an attendee with no services picked is refused",
    {
      eventId: camp.id,
      registrant: who,
      marketingConsent: false,
      attendees: [{ name: "Pat", serviceKeys: [] }],
    },
    "Pick at least one service.",
  );
  // The second row is the bad one. A loop that validates only attendees[0] is a
  // real and easy mistake, and this is the row that catches it.
  await refuses(
    "a bad SECOND attendee is caught, not just the first",
    {
      eventId: camp.id,
      registrant: who,
      marketingConsent: false,
      attendees: [
        { name: "Pat", serviceKeys: ["vv-consult"] },
        { name: "", serviceKeys: ["vv-consult"] },
      ],
    },
    "Attendee name is required.",
  );

  // ── 5. Services must be offered at THIS event ──
  console.log("\n5. Services must be offered at this event");
  await refuses(
    "a made-up service key is refused",
    { ...okOrder, quantities: [{ serviceKey: "totally-made-up", quantity: 1 }] },
    "Service not offered at this event: totally-made-up",
  );
  // The one that matters. A real, active service from the org's own catalogue,
  // offered at the camp and NOT here. Per-event offerings are the whole point of
  // ServiceCap; if this line ever passes, every event sells the entire menu.
  await refuses(
    "a real service offered only at the OTHER event is refused here",
    { ...okOrder, quantities: [{ serviceKey: "vv-camp-only", quantity: 1 }] },
    "Service not offered at this event: vv-camp-only",
  );
  await refuses(
    "one good line does not smuggle in a bad one",
    {
      ...okOrder,
      quantities: [
        { serviceKey: "vv-admission", quantity: 1 },
        { serviceKey: "vv-camp-only", quantity: 1 },
      ],
    },
    "Service not offered at this event: vv-camp-only",
  );
  // Attendee mode reaches the same rule down its own code path.
  await refuses(
    "attendee mode also refuses a service not offered here",
    {
      eventId: camp.id,
      registrant: who,
      marketingConsent: false,
      attendees: [{ name: "Pat", serviceKeys: ["vv-merch"] }],
    },
    "Service not offered at this event: vv-merch",
  );

  // ── 6. Membership plans ──
  console.log("\n6. Membership plan must exist, belong to the org, and be active");
  await refuses(
    "a nonexistent plan id is refused",
    { ...okOrder, membershipPlanId: "not-a-real-plan-id" },
    "Membership plan is not available.",
  );
  await refuses(
    "a DEACTIVATED plan is refused — retiring a plan must stop selling it",
    { ...okOrder, membershipPlanId: retired.id },
    "Membership plan is not available.",
  );

  // ── 7. Event state, enforced server-side ──
  // The UI would never render a form for a CLOSED event, which is exactly why
  // this is worth a row: the refusal has to live in createRegistration, because
  // a direct POST never touches the UI.
  console.log("\n7. A closed event refuses a direct POST");
  await refuses(
    "a CLOSED event with a future endsAt still refuses to sell",
    { eventId: closed.id, registrant: who, marketingConsent: false, quantities: oneTicket },
    "Registration for this event is not open.",
  );

  // ── 8. A refusal must not hand the buyer server internals ──
  // `toBuyerMessage` already learned this once for ZodError: its own comment
  // records that an `err.message` passthrough used to render a raw serialised
  // issue array in the red box. The rule generalises — anything reaching that box
  // has to read as copy — so it is asserted as a property here rather than as one
  // more equality case.
  console.log("\n8. No refusal leaks server internals to the buyer");
  const leakCases: [string, Record<string, unknown>][] = [
    ["blank name", { ...okOrder, registrant: { ...who, name: "" } }],
    ["negative quantity", { ...okOrder, quantities: [{ serviceKey: "vv-admission", quantity: -1 }] }],
    ["unknown service", { ...okOrder, quantities: [{ serviceKey: "made-up", quantity: 1 }] }],
    ["deactivated plan", { ...okOrder, membershipPlanId: retired.id }],
    ["closed event", { eventId: closed.id, registrant: who, marketingConsent: false, quantities: oneTicket }],
    // OPEN DEFECT, found by this suite on 2026-08-18. `createRegistration` opens
    // with `db.event.findUniqueOrThrow` (registration.ts:142), whose rejection is
    // a plain Error, so `toBuyerMessage` passes the message through verbatim: a
    // 456-character Prisma dump carrying the absolute path of the server source
    // file and a numbered snippet of it. eventId is a hidden field, so a buyer
    // reaches this only by editing the POST — but that is exactly who should not
    // be handed the server's directory layout. This row is expected to FAIL until
    // findUniqueOrThrow becomes findUnique with an explicit "That event could not
    // be found." refusal, and is left red on purpose rather than pinned to the
    // broken behaviour.
    ["nonexistent eventId", { ...okOrder, eventId: "cl000000000000000000000" }],
  ];
  for (const [label, input] of leakCases) {
    const r = await submit(bad(input));
    if (r.ok) {
      check(`${label}: refused at all`, "ACCEPTED", "refused");
      continue;
    }
    leaksNoInternals(`${label}: message reads as buyer copy`, r.error);
  }

  // ── 9. Whitespace is not content ──
  // OPEN DEFECT, found by this suite on 2026-08-18. Every required string is
  // `z.string().min(1)` (or `.min(7)` for phone) and zod counts a space, so a
  // field holding nothing but spaces, tabs or newlines satisfies it. Unlike the
  // eventId leak in section 8, this one needs no crafted POST — holding the
  // spacebar in the name field on a phone is enough, and a thumb on a 6" screen
  // does it by accident.
  //
  // What it costs: `formatCampId` prints the name onto the badge, so a
  // whitespace name yields a blank badge that registration cannot match to a
  // person at check-in, and a whitespace phone is an unreachable contact on the
  // one record the camp keeps. Seven spaces clear the phone's min(7) exactly the
  // way seven digits do.
  //
  // These rows assert the behaviour that SHOULD hold and are therefore expected
  // to FAIL until the schema trims before measuring — `z.string().trim().min(1)`
  // for name, `.trim().min(7)` for phone — which also stops a padded name being
  // stored with its padding. Left red on purpose rather than pinned to the gap.
  //
  // Asserted at the SCHEMA layer, not through `refuses`, and deliberately so:
  // these inputs are wrong only in the contact field, so everything else about
  // them is valid. Sent through the action they would create a real PENDING
  // order and — because the cart is non-zero — call Stripe for a live Checkout
  // session on every run of this file. A gap in a string rule does not need a
  // network round trip and a dangling session to prove.
  console.log("\n9. Whitespace-only entries must not count as content");
  faultsFields(
    "a name of three spaces faults registrant.name",
    { ...okOrder, registrant: { ...who, name: "   " } },
    ["registrant.name"],
  );
  faultsFields(
    "a name of a single tab faults registrant.name",
    { ...okOrder, registrant: { ...who, name: "\t" } },
    ["registrant.name"],
  );
  faultsFields(
    "a phone of seven spaces faults registrant.phone — it clears min(7) the way seven digits do",
    { ...okOrder, registrant: { ...who, phone: "       " } },
    ["registrant.phone"],
  );

  await volunteerCounselorAndLinkChecks();

  await cleanup(org.id);
}

/**
 * §10–§13 — volunteer signup: the counselor pair and the school's hours-approval
 * link (task G9). Schema-level only, so no rows are created and there is nothing
 * to clean up: `volunteerSignupSchema.safeParse` is a pure function and the
 * roleId below deliberately names no real role (whether a role EXISTS is a later
 * layer, settled by createVolunteerSignup, not by shape validation).
 *
 * Why these rows exist: a counselor NAME with no email used to pass validation
 * and was then silently discarded, because Counselor.email is non-null and is
 * the per-org dedupe key. The volunteer believed they had named their approver;
 * we stored nothing and told them nothing.
 */
async function volunteerCounselorAndLinkChecks(): Promise<void> {
  const volunteers = await import("../src/server/volunteers");
  const {
    counselorPairRequired,
    hasContent,
    hoursApprovalUrlIssue,
    HOURS_APPROVAL_URL_MAX,
  } = await import("../src/lib/volunteerRoles");
  const { validateEmail } = await import("../src/app/_components/ValidatedInput");

  type VolInput = Record<string, unknown>;
  const parseVol = (input: VolInput) => {
    const r = volunteers.volunteerSignupSchema.safeParse(input);
    if (r.success) return { ok: true as const, paths: [] as string[], messages: [] as string[] };
    return {
      ok: false as const,
      paths: r.error.issues.map((i) => i.path.join(".")).sort(),
      messages: [...new Set(r.error.issues.map((i) => i.message))],
    };
  };

  /** An adult with no school: no older trigger fires, so only the pairwise rule can. */
  const adult = {
    name: "Ada Volunteer",
    email: "ada.volunteer@example.test",
    phone: "555-0100",
    ageBand: "AGE_18_PLUS",
    roleId: "vv-role-shape-only",
  };

  function volFaults(label: string, input: VolInput, expectedPaths: string[]): void {
    const r = parseVol(input);
    check(label, r.ok ? "PARSED — no fault raised" : r.paths, expectedPaths.slice().sort());
  }
  function volAccepts(label: string, input: VolInput): void {
    check(label, parseVol(input).paths, []);
  }
  function volSays(label: string, input: VolInput, expected: string[]): void {
    const r = parseVol(input);
    check(label, r.ok ? "PARSED — no fault raised" : r.messages.sort(), expected.slice().sort());
  }

  console.log("\n10. The counselor pair is all-or-nothing (four combinations)");
  volAccepts("neither field: an adult with no school owes us no counselor", adult);
  volFaults(
    "name only: faults the missing email — a name alone CANNOT be stored, Counselor.email is the dedupe key",
    { ...adult, counselorName: "Ms. Reyes" },
    ["counselorEmail"],
  );
  volFaults(
    "email only: faults the missing name",
    { ...adult, counselorEmail: "reyes@school.test" },
    ["counselorName"],
  );
  volAccepts("both fields: accepted", {
    ...adult,
    counselorName: "Ms. Reyes",
    counselorEmail: "reyes@school.test",
  });
  volFaults(
    "a name of three spaces is not a name — faults counselorName",
    { ...adult, counselorName: "   ", counselorEmail: "reyes@school.test" },
    ["counselorName"],
  );
  volFaults(
    "an email of a single tab is not an email — faults counselorEmail",
    { ...adult, counselorName: "Ms. Reyes", counselorEmail: "\t" },
    ["counselorEmail"],
  );
  volAccepts("both fields whitespace-only is the same as neither — accepted", {
    ...adult,
    counselorName: "  ",
    counselorEmail: "   ",
  });
  volFaults(
    "a malformed counselor email is refused even with a name present",
    { ...adult, counselorName: "Ms. Reyes", counselorEmail: "reyes@school" },
    ["counselorEmail"],
  );
  volAccepts("a counselor email with stray spaces is trimmed, not refused", {
    ...adult,
    counselorName: "Ms. Reyes",
    counselorEmail: "  reyes@school.test  ",
  });
  volSays(
    "the pairwise copy names the half that is missing",
    { ...adult, counselorEmail: "reyes@school.test" },
    ["Add the counselor / advisor name too — we can't record an approver from an email alone."],
  );

  console.log("\n11. The older school / minor trigger still fires (it is the stricter one)");
  volFaults(
    "a school with no counselor faults BOTH fields, though the volunteer typed neither",
    { ...adult, school: "Edison High" },
    ["counselorName", "counselorEmail"],
  );
  volSays(
    "the student-trigger copy is unchanged",
    { ...adult, school: "Edison High", counselorEmail: "reyes@school.test" },
    ["Counselor / advisor name is required for students."],
  );
  volFaults(
    "a minor with no school still owes a counselor AND guardian consent",
    { ...adult, ageBand: "AGE_16_17" },
    ["counselorName", "counselorEmail", "guardianName"],
  );
  volAccepts("a school of three spaces is not a school — the student trigger must not fire on it", {
    ...adult,
    school: "   ",
  });

  console.log("\n12. The school's hours-approval link: optional, https-only, capped");
  volAccepts("no link at all is accepted — the field is optional", adult);
  volAccepts("a whitespace-only link is accepted as absent", {
    ...adult,
    hoursApprovalUrl: "   ",
  });
  volAccepts("an https link is accepted", {
    ...adult,
    hoursApprovalUrl: "https://www.x2vol.test/index.cfm/approve?token=abc123",
  });
  volAccepts("an https link with stray spaces is trimmed, not refused", {
    ...adult,
    hoursApprovalUrl: "  https://www.x2vol.test/approve  ",
  });
  volFaults(
    "plain http is refused — an approval token must not travel in the clear",
    { ...adult, hoursApprovalUrl: "http://www.x2vol.test/approve" },
    ["hoursApprovalUrl"],
  );
  volFaults(
    "javascript: is refused — it would execute in the coordinator's session",
    { ...adult, hoursApprovalUrl: "javascript:alert(1)" },
    ["hoursApprovalUrl"],
  );
  volFaults(
    "data: is refused for the same reason",
    { ...adult, hoursApprovalUrl: "data:text/html,alert" },
    ["hoursApprovalUrl"],
  );
  volFaults(
    "a string that is not a URL at all is refused",
    { ...adult, hoursApprovalUrl: "not a url" },
    ["hoursApprovalUrl"],
  );
  volFaults(
    "a protocol-relative //host is refused — it is not an absolute https URL",
    { ...adult, hoursApprovalUrl: "//www.x2vol.test/approve" },
    ["hoursApprovalUrl"],
  );
  volFaults(
    "a link past the length cap is refused",
    { ...adult, hoursApprovalUrl: "https://x2vol.test/" + "a".repeat(HOURS_APPROVAL_URL_MAX) },
    ["hoursApprovalUrl"],
  );

  console.log("\n13. The client is never stricter than the server");
  // THE load-bearing invariant on this codebase: a browser-side rule that
  // rejects what volunteerSignupSchema would accept turns a real volunteer away
  // with no recovery path. The counselor requirement and the link rule are not
  // re-implemented in the form — it calls counselorPairRequired and
  // hoursApprovalUrlIssue, the same functions the schema calls, so they are
  // identical by construction. Asserted here: the one remaining seam (the email
  // format, where the client is deliberately LOOSER) and the whole-input
  // property over a sample table.

  /** Exactly what VolunteerSignupForm.submit() evaluates before it will POST. */
  const clientBlocks = (i: VolInput): boolean => {
    const { required } = counselorPairRequired({
      school: i.school as string | undefined,
      ageBand: (i.ageBand as never) ?? null,
      counselorName: i.counselorName as string | undefined,
      counselorEmail: i.counselorEmail as string | undefined,
    });
    const name = (i.counselorName as string) ?? "";
    const email = (i.counselorEmail as string) ?? "";
    if (required && !hasContent(name)) return true;
    if (required && (!hasContent(email) || validateEmail(email) !== null)) return true;
    return hoursApprovalUrlIssue(i.hoursApprovalUrl as string | undefined) !== null;
  };

  const table: VolInput[] = [
    adult,
    { ...adult, counselorName: "Ms. Reyes", counselorEmail: "reyes@school.test" },
    { ...adult, counselorName: "  ", counselorEmail: "  " },
    { ...adult, counselorName: "Ms. Reyes", counselorEmail: "  reyes@school.test  " },
    { ...adult, school: "Edison High", counselorName: "R", counselorEmail: "r@s.test" },
    {
      ...adult,
      ageBand: "AGE_16_17",
      counselorName: "R",
      counselorEmail: "r@s.test",
      guardianName: "P",
    },
    { ...adult, hoursApprovalUrl: "" },
    { ...adult, hoursApprovalUrl: "   " },
    { ...adult, hoursApprovalUrl: "https://x2vol.test/a?t=1" },
    { ...adult, hoursApprovalUrl: "HTTPS://X2VOL.TEST/A" },
    { ...adult, hoursApprovalUrl: "https://x2vol.test/" + "a".repeat(HOURS_APPROVAL_URL_MAX - 40) },
    { ...adult, counselorEmail: "reyes@school.test" },
    { ...adult, counselorName: "Ms. Reyes" },
    { ...adult, hoursApprovalUrl: "http://x2vol.test" },
    { ...adult, hoursApprovalUrl: "javascript:alert(1)" },
  ];
  const overreach = table
    .filter((i) => parseVol(i).ok && clientBlocks(i))
    .map((i) => JSON.stringify(i));
  check(
    "no input the schema ACCEPTS is blocked by the form (" + table.length + " samples)",
    overreach,
    [],
  );

  const addresses = [
    "a@b.co",
    "ada+tag@example.co.uk",
    "x.y@sub.domain.example.museum",
    "ADA@EXAMPLE.TEST",
    "a@b.c",
    "no-at-sign",
    "a@b",
    "a b@c.com",
    "",
  ];
  const schemaTakesEmail = (s: string) =>
    parseVol({ ...adult, counselorName: "Ms. Reyes", counselorEmail: s }).ok;
  const tighter = addresses.filter((a) => schemaTakesEmail(a) && validateEmail(a) !== null);
  check(
    "validateEmail accepts every counselor address the schema accepts (" +
      addresses.length +
      " samples)",
    tighter,
    [],
  );

  // The link rule asserted as EQUIVALENCE, not one-way: it is the same function
  // on both sides, so any disagreement means someone forked it.
  const links = [
    "",
    "   ",
    "https://x2vol.test/approve",
    "HTTPS://X2VOL.TEST/APPROVE",
    "  https://x2vol.test/approve  ",
    "http://x2vol.test/approve",
    "javascript:alert(1)",
    "data:text/html,alert",
    "not a url",
    "//x2vol.test/approve",
    "https://x2vol.test/" + "a".repeat(HOURS_APPROVAL_URL_MAX),
  ];
  const forked = links.filter(
    (l) => parseVol({ ...adult, hoursApprovalUrl: l }).ok !== (hoursApprovalUrlIssue(l) === null),
  );
  check(
    "the form and the schema agree on every link (" +
      links.length +
      " samples — same function, so any gap is a fork)",
    forked,
    [],
  );
}

/**
 * Remove everything this script creates. Nothing here should ever create an
 * order — every case is expected to be refused — so a leftover order is itself a
 * signal, and the sweep reports one rather than assuming it cannot happen.
 *
 * Every key this script creates must appear here. A suite that leaks rows into a
 * shared dev database silently changes what the next manual test sees —
 * `verify-earlybird` escaped exactly that way (see verify-pricing.ts).
 */
async function cleanup(orgId: string): Promise<void> {
  const events = await db.event.findMany({
    where: { orgId, code: { in: [CODE, CAMP_CODE, CLOSED_CODE] } },
  });
  for (const event of events) {
    const orders = await db.order.findMany({ where: { eventId: event.id }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      console.log(
        `  NOTE  cleanup removed ${orderIds.length} order(s) from ${event.code} — every case here should have been refused`,
      );
    }
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    await db.ledgerEntry.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.event.delete({ where: { id: event.id } }); // cascades orders/attendees/lines
  }
  await db.member.deleteMany({ where: { orgId, email: EMAIL } });
  await db.membershipPlan.deleteMany({ where: { orgId, key: PLAN_KEY } });
  await db.serviceType.deleteMany({ where: { orgId, key: { in: KEYS } } });
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
