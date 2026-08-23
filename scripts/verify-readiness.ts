/**
 * Setup-readiness check — the derivation behind /admin's readiness card and the
 * lifecycle rail. Builds scratch events, one per blocker, then cleans up.
 *
 *   npx tsx scripts/verify-readiness.ts
 *
 * Sibling of verify-pricing.ts / verify-validation.ts / verify-storage.ts /
 * verify-performance.ts.
 *
 * WHAT THIS EXISTS TO PIN:
 *
 *   1. EACH BLOCKER FIRES ON ITS OWN FIXTURE AND ONLY THEN. The method is a
 *      complete event that scores 5 of 5, then one thing removed at a time. A
 *      checklist that says "1 blocker" when two things are wrong, or that leaves
 *      a row red after it has been satisfied, is worse than no checklist —
 *      people stop reading it and then miss the one that mattered.
 *
 *   2. A GENERAL EVENT IS NOT BLOCKED FOR HAVING NO STATIONS. A dandiya night
 *      has no patient routing and never will. Scoring one 4-of-5 forever, with a
 *      blocker nobody can clear, is exactly how a card becomes wallpaper. Five
 *      of the six events on the dev database are GENERAL, so this is the common
 *      case, not an edge one.
 *
 *   3. VOLUNTEER FILL COUNTS NON-CANCELLED SIGNUPS AGAINST SUMMED CAPACITY, and
 *      treats a NAMED ROLE WITH NOBODY IN IT as the blocker rather than any
 *      shortfall. This number is computed nowhere else in the app, so nothing
 *      else would notice if `status: { not: "CANCELLED" }` were dropped — a
 *      withdrawn volunteer would quietly count as staffing a station.
 *
 *   4. THE FIRST BLOCKER IN FLOW ORDER OWNS THE ACTION. The card has one button.
 *      If it aims at the wrong row, it sends a coordinator to assign volunteers
 *      to stations that do not exist yet.
 *
 *   5. THE LIFECYCLE RAIL IS DERIVED FROM NEXT_STATUS. It is drawn from a graph
 *      walk precisely so a sixth status cannot appear in the state machine and
 *      be missing from the rail. If someone replaces the walk with a literal
 *      array, this goes red.
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

const CODE_PREFIX = "VERIFY-RDY";
const SERVICE_KEY = "verify-rdy-service";
const VOLUNTEER_EMAIL = "verify-rdy-volunteer@example.org";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const DAY = 86_400_000;

/** What a fixture may be missing. Absent from the set = that step is complete. */
type Gap = "services" | "stations" | "registration" | "volunteers" | "flags";

async function main() {
  const { getEventReadiness, whenPhrase } = await import("../src/server/events");
  const { LIFECYCLE_RAIL, railPositionOf, stageLabel, NEXT_STATUS, STATUS_STYLE } =
    await import("../src/lib/eventLifecycle");
  const { venueDaysUntil } = await import("../src/lib/eventTime");

  const org = await db.organization.findFirstOrThrow();
  await cleanup(org.id);

  // ── The lifecycle rail is DERIVED, not listed ────────────────────────────
  console.log("\nLifecycle rail");
  const labels = LIFECYCLE_RAIL.map((s) => s.label);
  check(
    "five segments: DRAFT · OPEN · ACTIVE · CLOSED · PURGED",
    labels.join(" ") === "DRAFT OPEN ACTIVE CLOSED PURGED",
    labels.join(" "),
  );
  const covered = LIFECYCLE_RAIL.flatMap((s) => s.covers);
  check(
    "every status in NEXT_STATUS has a segment",
    Object.keys(NEXT_STATUS).every((s) => covered.includes(s as never)),
    `covers: ${covered.join(",")}`,
  );
  check(
    "no status is covered twice",
    new Set(covered).size === covered.length,
  );
  check(
    "PURGEABLE shares the last segment with PURGED",
    railPositionOf("PURGEABLE") === railPositionOf("PURGED"),
  );
  check(
    "a PURGEABLE event is labelled PURGEABLE, not PURGED",
    stageLabel(LIFECYCLE_RAIL[railPositionOf("PURGEABLE")], "PURGEABLE") === "PURGEABLE",
  );
  check(
    "the rail follows the longest path, not the OPEN → CLOSED shortcut",
    railPositionOf("OPEN") < railPositionOf("ACTIVE") &&
      railPositionOf("ACTIVE") < railPositionOf("CLOSED"),
  );
  check(
    "every status has a pill style",
    Object.keys(NEXT_STATUS).every((s) => Boolean(STATUS_STYLE[s as never])),
  );

  // ── Days-to-camp is a venue-calendar count ───────────────────────────────
  console.log("\nDays to event day");
  // 2026-01-17 09:00 America/Chicago = 15:00Z. "Now" is 04:00Z on the 16th,
  // which is still the evening of the 15th at the venue — two venue days out.
  // A naive (target - now) / 86_400_000 rounds 1.46 to 1 and is a day short.
  const campDay = new Date("2026-01-17T15:00:00Z");
  const evening = new Date("2026-01-16T04:00:00Z");
  check(
    "counts venue calendar days, not elapsed milliseconds",
    venueDaysUntil(campDay, evening) === 2 &&
      Math.round((campDay.getTime() - evening.getTime()) / DAY) === 1,
    String(venueDaysUntil(campDay, evening)),
  );
  check(
    "0 means today at the venue",
    venueDaysUntil(campDay, new Date("2026-01-17T23:00:00Z")) === 0,
  );
  check(
    "negative once the event is past",
    venueDaysUntil(campDay, new Date("2026-01-20T15:00:00Z")) === -3,
  );
  check("phrase reads as English", whenPhrase(12) === "in 12 days" && whenPhrase(0) === "today" && whenPhrase(-3) === "3 days ago");

  // ── The complete camp: nothing outstanding ───────────────────────────────
  console.log("\nA fully set-up CAMP");
  const service = await db.serviceType.upsert({
    where: { orgId_key: { orgId: org.id, key: SERVICE_KEY } },
    update: {},
    create: {
      orgId: org.id, key: SERVICE_KEY, name: "Readiness Check",
      priceCents: 1000, kind: "ADMISSION",
    },
  });
  // Two people, because VolunteerSignup is @@unique([volunteerId, eventId]) —
  // one volunteer holds at most one role per event, so staffing two roles takes
  // two humans. Worth knowing before writing a fixture that pretends otherwise.
  const volunteers = await Promise.all(
    [1, 2].map((n) =>
      db.volunteer.upsert({
        where: { orgId_email: { orgId: org.id, email: `${n}${VOLUNTEER_EMAIL}` } },
        update: {},
        create: {
          orgId: org.id,
          name: `Readiness Volunteer ${n}`,
          email: `${n}${VOLUNTEER_EMAIL}`,
        },
      }),
    ),
  );

  /**
   * A camp with everything done, minus whatever `gaps` names.
   *
   * `sells` is the `offersRegistration` flag and defaults to the schema's own
   * default (true), so every fixture written before the services row learned
   * about the public door keeps scoring exactly as it did.
   */
  async function fixture(
    suffix: string,
    gaps: Gap[],
    type: "CAMP" | "GENERAL" = "CAMP",
    opts: { sells?: boolean } = {},
  ) {
    const missing = new Set(gaps);
    const event = await db.event.create({
      data: {
        orgId: org.id,
        type,
        // The registration row is about status, so DRAFT is how that gap is made.
        status: missing.has("registration") ? "DRAFT" : "OPEN",
        code: `${CODE_PREFIX}-${suffix}`,
        name: `Readiness fixture ${suffix}`,
        offersRegistration: opts.sells ?? true,
        // Relative, never literal: a hardcoded date turns the consequence copy
        // ("Camp day is in 12 days") into a lie the moment it passes.
        startsAt: new Date(Date.now() + 12 * DAY),
        endsAt: new Date(Date.now() + 12 * DAY + 4 * 3600_000),
        flagsReviewedAt: missing.has("flags") ? null : new Date(),
      },
    });
    if (!missing.has("services")) {
      await db.serviceCap.create({
        data: { eventId: event.id, serviceTypeId: service.id, priceCents: 1000 },
      });
    }
    if (!missing.has("stations")) {
      await db.station.create({
        data: { orgId: org.id, eventId: event.id, key: "checkin", name: "Check-In", sequence: 1 },
      });
    }
    // Two roles ALWAYS, so "no volunteers assigned to <named role>" has a name
    // to print and the all-empty case is distinguishable from the partial one.
    const vitals = await db.volunteerRole.create({
      data: { orgId: org.id, eventId: event.id, key: "vitals", name: "Vitals", capacity: 4 },
    });
    const labs = await db.volunteerRole.create({
      data: { orgId: org.id, eventId: event.id, key: "labs", name: "Labs", capacity: 5 },
    });
    if (!missing.has("volunteers")) {
      for (const [i, role] of [vitals, labs].entries()) {
        await db.volunteerSignup.create({
          data: { volunteerId: volunteers[i].id, eventId: event.id, roleId: role.id },
        });
      }
    }
    const [readiness] = await getEventReadiness(org.id, { eventId: event.id });
    return { event, readiness, vitals, labs };
  }

  const item = (r: Awaited<ReturnType<typeof fixture>>["readiness"], key: Gap) =>
    r.items.find((i) => i.key === key);

  const full = await fixture("FULL", []);
  check("scores 5 of 5", full.readiness.done === 5 && full.readiness.total === 5,
    `${full.readiness.done} of ${full.readiness.total}`);
  check("no blockers", full.readiness.blockers === 0);
  check("no action, because there is nothing to point at", full.readiness.firstBlocker === null);
  check("services row states the count", item(full.readiness, "services")?.label === "1 service priced, caps set",
    item(full.readiness, "services")?.label);
  check("stations row states the count", item(full.readiness, "stations")?.label === "1 station in route order",
    item(full.readiness, "stations")?.label);
  check("a satisfied row states no consequence",
    full.readiness.items.every((i) => i.consequence === undefined));
  check("volunteer row states fill against summed capacity",
    item(full.readiness, "volunteers")?.label === "2 of 9 volunteer places filled",
    item(full.readiness, "volunteers")?.label);
  check("a partly-filled roster is not a blocker",
    item(full.readiness, "volunteers")?.done === true);

  // ── One gap at a time: fires, and ONLY it fires ──────────────────────────
  console.log("\nEach blocker, alone");
  for (const gap of ["services", "stations", "registration", "volunteers", "flags"] as const) {
    const f = await fixture(gap.toUpperCase(), [gap]);
    const r = f.readiness;
    check(`${gap}: exactly one blocker`, r.blockers === 1,
      `${r.blockers} — ${r.items.filter((i) => !i.done).map((i) => i.key).join(",")}`);
    check(`${gap}: it is the ${gap} row`, item(r, gap)?.done === false);
    check(`${gap}: every other row is satisfied`,
      r.items.filter((i) => i.key !== gap).every((i) => i.done));
    check(`${gap}: the blocked row states a consequence in words`,
      (item(r, gap)?.consequence ?? "").length > 20, item(r, gap)?.consequence);
    check(`${gap}: the action points at the ${gap} row`, r.firstBlocker?.key === gap,
      r.firstBlocker?.key);
    check(`${gap}: the action links somewhere real`,
      (r.firstBlocker?.href ?? "").startsWith(`/admin/camps/${f.event.id}`),
      r.firstBlocker?.href);
    check(`${gap}: scores 4 of 5`, r.done === 4 && r.total === 5, `${r.done} of ${r.total}`);
  }

  // ── Flow order decides who owns the one action ───────────────────────────
  console.log("\nFlow order owns the action");
  const everything = await fixture("NONE", ["services", "stations", "registration", "volunteers", "flags"]);
  check("all five blocked", everything.readiness.blockers === 5, String(everything.readiness.blockers));
  check("services — the first in flow order — owns it",
    everything.readiness.firstBlocker?.key === "services", everything.readiness.firstBlocker?.key);
  const later = await fixture("LATER", ["stations", "volunteers", "flags"]);
  check("with services done, stations owns it",
    later.readiness.firstBlocker?.key === "stations", later.readiness.firstBlocker?.key);
  const lastOnly = await fixture("FLAGSONLY", ["flags"]);
  check("with only the last row unmet, it owns it",
    lastOnly.readiness.firstBlocker?.key === "flags", lastOnly.readiness.firstBlocker?.key);

  // ── A GENERAL event has no stations, and that is not a fault ─────────────
  console.log("\nGENERAL events are not scored on stations");
  const general = await fixture("GENERAL", ["stations"], "GENERAL");
  check("no stations row at all", item(general.readiness, "stations") === undefined);
  check("scored out of four, not five", general.readiness.total === 4, String(general.readiness.total));
  check("nothing outstanding despite zero stations", general.readiness.blockers === 0);
  const generalBroken = await fixture("GENBAD", ["stations", "services"], "GENERAL");
  check("its other rows still work", generalBroken.readiness.firstBlocker?.key === "services",
    generalBroken.readiness.firstBlocker?.key);
  check("and it is 3 of 4", generalBroken.readiness.done === 3 && generalBroken.readiness.total === 4,
    `${generalBroken.readiness.done} of ${generalBroken.readiness.total}`);

  // ── Publicly open with nothing to sell is a different class of failure ───
  console.log("\nOpen to the public with nothing priced");
  check("flagged as broken in public", item(generalBroken.readiness, "services")?.brokenInPublic === true);
  check("the consequence names what a guest hits",
    (item(generalBroken.readiness, "services")?.consequence ?? "").includes("empty form"),
    item(generalBroken.readiness, "services")?.consequence);
  const draftNoServices = await fixture("DRAFTBAD", ["services", "registration"]);
  check("a DRAFT event with no services is NOT broken in public",
    item(draftNoServices.readiness, "services")?.brokenInPublic === false);
  check("nothing else ever claims to be broken in public",
    full.readiness.items.every((i) => !i.brokenInPublic) &&
      later.readiness.items.every((i) => !i.brokenInPublic));

  // ── Priced but unreachable: the other half of the same question ──────────
  //
  // The prod defect of 2026-08-23. DCICA Festival of Lights carried a $30
  // Competition Entry at capacity 25 while `offersRegistration` was false, so
  // the home page linked neither Register nor Enter-a-performance and the
  // offering could not be bought by anyone. The card scored the event green,
  // because this row counted priced services and never asked whether a door
  // existed. Both directions are pinned here.
  console.log("\nPriced, but the public door is shut");
  const shutWithPrices = await fixture("SHUTPRICED", [], "GENERAL", { sells: false });
  const shutRow = item(shutWithPrices.readiness, "services");
  check("a priced service behind a closed door is NOT done", shutRow?.done === false,
    `done=${shutRow?.done} — ${shutRow?.label}`);
  check("the label says the event is not selling",
    (shutRow?.label ?? "").includes("not selling"), shutRow?.label);
  check("the consequence names the flag, not the price list",
    (shutRow?.consequence ?? "").includes("Sell to the public"), shutRow?.consequence);
  check("flagged as broken in public — a guest cannot buy it today",
    shutRow?.brokenInPublic === true);
  check("the action points at the flag on camp detail, not back at /services",
    shutRow?.href === `/admin/camps/${shutWithPrices.event.id}` &&
      shutRow?.action === "Open the public door",
    `${shutRow?.action} → ${shutRow?.href}`);

  // The inverse. A free community night — vendors and volunteers only — is a
  // FINISHED configuration. Scoring it "No services priced" put a blocker on it
  // that nobody could ever clear, under a consequence describing a Register
  // button the event does not have.
  const freeNight = await fixture("FREENIGHT", ["services"], "GENERAL", { sells: false });
  const freeRow = item(freeNight.readiness, "services");
  check("an event that sells nothing on purpose is done, not blocked",
    freeRow?.done === true, `done=${freeRow?.done} — ${freeRow?.label}`);
  check("and it states that rather than counting to zero",
    freeRow?.label === "Not selling anything (public registration is off)", freeRow?.label);
  check("a done row still states no consequence", freeRow?.consequence === undefined,
    freeRow?.consequence);
  check("it is not painted as broken in public", freeRow?.brokenInPublic === false);
  check("so a free public event has no services blocker at all",
    freeNight.readiness.items.filter((i) => !i.done && i.key === "services").length === 0);

  // ── Volunteer fill: which signups count, and which zero matters ──────────
  console.log("\nVolunteer fill");
  const partial = await fixture("PARTIAL", ["volunteers"]);
  await db.volunteerSignup.create({
    data: { volunteerId: volunteers[0].id, eventId: partial.event.id, roleId: partial.vitals.id },
  });
  const [partialR] = await getEventReadiness(org.id, { eventId: partial.event.id });
  check("a role with nobody in it is named, not just counted",
    item(partialR, "volunteers")?.label === "No volunteers assigned to Labs",
    item(partialR, "volunteers")?.label);
  check("the consequence carries the clock and the shortfall",
    (item(partialR, "volunteers")?.consequence ?? "").includes("1 of 9 volunteer places filled"),
    item(partialR, "volunteers")?.consequence);

  const cancelled = await fixture("CANCELLED", []);
  await db.volunteerSignup.updateMany({
    where: { eventId: cancelled.event.id },
    data: { status: "CANCELLED" },
  });
  const [cancelledR] = await getEventReadiness(org.id, { eventId: cancelled.event.id });
  check("a CANCELLED signup does not staff a role",
    item(cancelledR, "volunteers")?.label === "No volunteers signed up",
    item(cancelledR, "volunteers")?.label);
  check("and it becomes a blocker", item(cancelledR, "volunteers")?.done === false);

  const waitlisted = await fixture("WAITLIST", []);
  await db.volunteerSignup.updateMany({
    where: { eventId: waitlisted.event.id },
    data: { status: "WAITLISTED" },
  });
  const [waitlistedR] = await getEventReadiness(org.id, { eventId: waitlisted.event.id });
  check("every OTHER status still counts as a commitment",
    item(waitlistedR, "volunteers")?.done === true,
    item(waitlistedR, "volunteers")?.label);

  const noRoles = await fixture("NOROLES", []);
  await db.volunteerSignup.deleteMany({ where: { eventId: noRoles.event.id } });
  await db.volunteerRole.deleteMany({ where: { eventId: noRoles.event.id } });
  const [noRolesR] = await getEventReadiness(org.id, { eventId: noRoles.event.id });
  check("no roles defined reads differently from no signups",
    item(noRolesR, "volunteers")?.label === "No volunteer roles defined",
    item(noRolesR, "volunteers")?.label);

  const inactive = await fixture("INACTIVE", ["volunteers"]);
  await db.volunteerRole.updateMany({
    where: { eventId: inactive.event.id },
    data: { active: false },
  });
  const [inactiveR] = await getEventReadiness(org.id, { eventId: inactive.event.id });
  check("a deactivated role is not counted at all",
    item(inactiveR, "volunteers")?.label === "No volunteer roles defined",
    item(inactiveR, "volunteers")?.label);

  // ── Registration: the end states are not unfinished work ─────────────────
  console.log("\nRegistration row");
  const closed = await fixture("CLOSED", []);
  await db.event.update({ where: { id: closed.event.id }, data: { status: "CLOSED" } });
  const [closedR] = await getEventReadiness(org.id, { eventId: closed.event.id });
  check("a CLOSED event has not left registration undone",
    item(closedR, "registration")?.done === true, item(closedR, "registration")?.label);
  check("zero registrations on an open event is not a blocker",
    item(full.readiness, "registration")?.done === true,
    item(full.readiness, "registration")?.label);
  check("and it says so in words rather than printing a 0",
    item(full.readiness, "registration")?.label === "Registration open, nobody registered yet",
    item(full.readiness, "registration")?.label);

  // ── Soonest first, finished last ─────────────────────────────────────────
  console.log("\nOrder");
  const past = await db.event.create({
    data: {
      orgId: org.id, type: "GENERAL", status: "ACTIVE",
      code: `${CODE_PREFIX}-PAST`, name: "Readiness fixture PAST",
      startsAt: new Date(Date.now() - 160 * DAY),
      endsAt: new Date(Date.now() - 160 * DAY + 4 * 3600_000),
    },
  });
  const soon = await db.event.create({
    data: {
      orgId: org.id, type: "GENERAL", status: "OPEN",
      code: `${CODE_PREFIX}-SOON`, name: "Readiness fixture SOON",
      startsAt: new Date(Date.now() + 2 * DAY),
      endsAt: new Date(Date.now() + 2 * DAY + 4 * 3600_000),
    },
  });
  const ordered = (await getEventReadiness(org.id)).filter((e) => e.code.startsWith(CODE_PREFIX));
  check("the soonest upcoming event leads", ordered[0]?.id === soon.id, ordered[0]?.code);
  check("a finished event never leads", ordered[ordered.length - 1]?.id === past.id,
    ordered[ordered.length - 1]?.code);
  check("upcoming events run soonest-first",
    ordered
      .filter((e) => !e.hasFinished)
      .every((e, i, a) => i === 0 || a[i - 1].startsAt <= e.startsAt));
  check("the finished one is marked finished",
    ordered.find((e) => e.id === past.id)?.hasFinished === true);

  await cleanup(org.id);
}

/** Remove everything this script creates. */
async function cleanup(orgId: string): Promise<void> {
  // Stations, caps, roles and signups all cascade from the event.
  await db.event.deleteMany({ where: { orgId, code: { startsWith: CODE_PREFIX } } });
  await db.volunteer.deleteMany({ where: { orgId, email: { endsWith: VOLUNTEER_EMAIL } } });
  await db.serviceType.deleteMany({ where: { orgId, key: SERVICE_KEY } });
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
