/**
 * Move one event through its lifecycle, and/or set its public doors.
 *
 *   ENV_FILE=<env> EVENT_CODE=DIW-2026 STATUS=OPEN \
 *     npx tsx scripts/set-event-status.ts                        # dry run
 *   ... --commit                                                 # writes
 *   ENV_FILE=<env> EVENT_CODE=DIW-2026 OFFERS_VENDORS=true \
 *     npx tsx scripts/set-event-status.ts --commit               # doors only
 *
 * The admin UI does both of these and is the right place day to day:
 * /admin/camps/<id> → "Lifecycle" → the "Open registration" button, and the
 * "Public doors" card → "Take vendor registrations". This mirrors
 * `transitionCamp` and `setEventDoors` in src/app/admin/camps/actions.ts for
 * the case that UI cannot serve: an operator at a laptop against prod, where
 * Google OAuth is the only way in and the event opens in eleven days.
 *
 * SAME RULES AS THE UI. The move must be one `NEXT_STATUS` allows — OPEN from
 * DRAFT, never OPEN from CLOSED — and PURGED is refused outright: that
 * transition strips attendee PII inside a transaction and is coordinator-only
 * for a reason, so it stays behind the button.
 *
 * WHAT IT PRINTS IS WHAT THE PUBLIC WILL SEE. The dry run lists the buttons
 * the home page will render after the change, computed by the same
 * `eventActions` the page uses, because the door an operator means to open is
 * rarely the only one that opens. Setting the Festival of Lights OPEN for its
 * vendor button also puts a $30 "Enter a performance" on the front page, and
 * that is worth reading before `--commit`.
 *
 * THE KIND (TYPE=GENERAL|CAMP). `updateCamp` only lets the kind change while
 * the event is a DRAFT, because the UI has no way back to DRAFT once an event
 * is listed — so an event opened under the wrong kind (a parade created as a
 * "Medical camp") was stuck with that label and the per-patient form for good.
 * The real hazard behind that rule is a kind change under someone who has
 * already paid; that check is kept here as a hard refusal. A non-DRAFT event
 * is allowed, with a printed warning. As in the UI, changing the kind resets
 * `collectsAttendeeDetails` (CAMP = on). EVENT_ID may stand in for EVENT_CODE.
 *
 * PRISMA MODEL OP, NEVER RAW SQL. See the note in src/server/payments.ts on
 * the pooler and `search_path`; `db.event.update` is schema-qualified.
 */
import * as dotenv from "dotenv";
import { PrismaClient, type EventStatus } from "@prisma/client";
import { NEXT_STATUS, STATUS_ACTION_LABEL } from "../src/lib/eventLifecycle";
import { eventActions } from "../src/lib/eventActions";

dotenv.config({ path: process.env.ENV_FILE ?? ".env", override: true });

const db = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

const EVENT_CODE = process.env.EVENT_CODE ?? "";
const EVENT_ID = process.env.EVENT_ID ?? "";
const STATUS = (process.env.STATUS ?? "").toUpperCase();
const TYPE = (process.env.TYPE ?? "").toUpperCase();
const TYPE_LABELS: Record<string, string> = { CAMP: "medical camp", GENERAL: "general event" };

const STATUSES: readonly EventStatus[] = [
  "DRAFT",
  "OPEN",
  "ACTIVE",
  "CLOSED",
  "PURGEABLE",
  "PURGED",
];

type Doors = {
  offersRegistration: boolean;
  offersVendors: boolean;
  offersVolunteers: boolean;
};

const DOOR_ENV: Record<keyof Doors, string> = {
  offersRegistration: "OFFERS_REGISTRATION",
  offersVendors: "OFFERS_VENDORS",
  offersVolunteers: "OFFERS_VOLUNTEERS",
};

/** "true" / "false" only. Anything else is a typo, and a typo must not write. */
function parseDoor(name: string): boolean | undefined | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function fmt(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

async function main() {
  if (!EVENT_CODE && !EVENT_ID) {
    console.log("Set EVENT_CODE or EVENT_ID, plus STATUS, TYPE and/or one of OFFERS_*.");
    process.exitCode = 1;
    return;
  }
  if (TYPE && !(TYPE in TYPE_LABELS)) {
    console.log(`TYPE must be GENERAL or CAMP.`);
    process.exitCode = 1;
    return;
  }
  if (STATUS && !STATUSES.includes(STATUS as EventStatus)) {
    console.log(`STATUS must be one of ${STATUSES.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  if (STATUS === "PURGED") {
    console.log(
      "PURGED strips attendee PII and is coordinator-only. Use the admin UI.",
    );
    process.exitCode = 1;
    return;
  }

  const doorChanges: Partial<Doors> = {};
  for (const key of Object.keys(DOOR_ENV) as (keyof Doors)[]) {
    const v = parseDoor(DOOR_ENV[key]);
    if (v === null) {
      console.log(`${DOOR_ENV[key]} must be exactly "true" or "false".`);
      process.exitCode = 1;
      return;
    }
    if (v !== undefined) doorChanges[key] = v;
  }

  if (!STATUS && !TYPE && Object.keys(doorChanges).length === 0) {
    console.log("Nothing to change: set STATUS, TYPE and/or one of OFFERS_*.");
    process.exitCode = 1;
    return;
  }

  const matches = await db.event.findMany({
    where: EVENT_ID ? { id: EVENT_ID } : { code: EVENT_CODE },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      collectsAttendeeDetails: true,
      status: true,
      startsAt: true,
      endsAt: true,
      offersRegistration: true,
      offersVendors: true,
      offersVolunteers: true,
      org: { select: { slug: true } },
      caps: {
        where: { serviceType: { active: true } },
        select: {
          priceCents: true,
          capacity: true,
          sold: true,
          serviceType: { select: { key: true, kind: true } },
        },
      },
    },
  });
  if (matches.length === 0) {
    console.log(`No event with ${EVENT_ID ? `id ${EVENT_ID}` : `code ${EVENT_CODE}`}.`);
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    console.log(
      `${matches.length} events share code ${EVENT_CODE} ` +
        `(orgs ${matches.map((m) => m.org.slug).join(", ")}). Refusing to guess.`,
    );
    process.exitCode = 1;
    return;
  }
  const event = matches[0];
  const now = new Date();

  const target = (STATUS || event.status) as EventStatus;
  const statusChanges = target !== event.status;
  if (statusChanges && !NEXT_STATUS[event.status].includes(target)) {
    console.log(
      `Can't move from ${event.status} to ${target}. ` +
        `From ${event.status} the UI offers: ` +
        (NEXT_STATUS[event.status]
          .map((s) => `${s} ("${STATUS_ACTION_LABEL[s]}")`)
          .join(", ") || "nothing"),
    );
    process.exitCode = 1;
    return;
  }

  const before: Doors = {
    offersRegistration: event.offersRegistration,
    offersVendors: event.offersVendors,
    offersVolunteers: event.offersVolunteers,
  };
  const after: Doors = { ...before, ...doorChanges };
  const doorsChange = (Object.keys(before) as (keyof Doors)[]).some(
    (k) => before[k] !== after[k],
  );

  // ── The kind, guarded (see header) ──
  const nextType = (TYPE || event.type) as typeof event.type;
  const typeChanges = nextType !== event.type;
  if (typeChanges) {
    if (event.type === "MEMBERSHIP_DRIVE") {
      console.log("A membership drive's kind is fixed. Refusing.");
      process.exitCode = 1;
      return;
    }
    // Same test as updateCamp: a camp ID is minted only on confirmation.
    const paid = await db.attendee.count({
      where: { eventId: event.id, campId: { not: null } },
    });
    if (paid > 0) {
      console.log(
        `${paid} confirmed attendee(s) on this event. The kind cannot change ` +
          `once anyone has registered. Refusing.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"} — set-event-status`);
  console.log(`  env file   ${process.env.ENV_FILE ?? ".env"}`);
  console.log(`  ${event.code}  ${event.name}  (org ${event.org.slug})`);
  console.log(`  ${fmt(event.startsAt)} -> ${fmt(event.endsAt)}`);
  console.log(
    `  status     ${event.status}` +
      (statusChanges ? ` -> ${target}` : "   (unchanged)"),
  );
  console.log(
    `  kind       ${TYPE_LABELS[event.type] ?? event.type}` +
      (typeChanges
        ? ` -> ${TYPE_LABELS[nextType]}  (per-person details form: ` +
          `${event.collectsAttendeeDetails} -> ${nextType === "CAMP"})`
        : "   (unchanged)"),
  );
  if (typeChanges && event.status !== "DRAFT")
    console.log(
      `    WARN  event is ${event.status}; the admin UI only changes the kind ` +
        `in DRAFT. No one has registered yet, so nothing confirmed is affected.`,
    );
  for (const k of Object.keys(before) as (keyof Doors)[]) {
    console.log(
      `  ${k.padEnd(20)} ${String(before[k]).padEnd(5)}` +
        (before[k] !== after[k] ? ` -> ${after[k]}` : "   (unchanged)"),
    );
  }

  if (!statusChanges && !doorsChange && !typeChanges) {
    console.log(`\nAlready in that state. Nothing to write.`);
    return;
  }

  // What the front page will show once this lands — the same function the
  // page calls, fed the same per-service kinds.
  const kinds = {
    hasFee: event.caps.some((c) => c.serviceType.kind === "FEE"),
    hasOther: event.caps.some((c) => c.serviceType.kind !== "FEE"),
  };
  const listed = target === "OPEN" || target === "ACTIVE";
  const actions = eventActions({ id: event.id, type: nextType, ...after }, kinds);
  console.log(
    `\n  Public listing after this change: ` +
      (listed ? "LISTED on the home page" : `not listed (${target})`),
  );
  if (listed) {
    if (actions.length === 0) console.log(`    (no buttons — every door is off)`);
    for (const a of actions) console.log(`    [${a.label}]  ${a.href}`);
    for (const c of event.caps) {
      console.log(
        `    offering ${c.serviceType.key} (${c.serviceType.kind})  ` +
          `$${((c.priceCents ?? 0) / 100).toFixed(2)}  ` +
          `${c.sold} / ${c.capacity ?? "uncapped"} sold`,
      );
    }
    if (after.offersRegistration && event.caps.length === 0)
      console.log(
        `    WARN  selling to the public with nothing priced — the Register ` +
          `button opens an empty form.`,
      );
    if (!after.offersRegistration && event.caps.length > 0)
      console.log(
        `    WARN  ${event.caps.length} priced offering(s) with "Sell to the ` +
          `public" off — reachable by nobody.`,
      );
    if (event.endsAt < now)
      console.log(`    WARN  this event already ended (${fmt(event.endsAt)}).`);
  }

  if (!COMMIT) {
    console.log(`\nDry run only. Re-run with --commit to write.`);
    return;
  }

  await db.event.update({
    where: { id: event.id },
    data: {
      ...(statusChanges
        ? {
            status: target,
            ...(target === "CLOSED" ? { closedAt: now } : {}),
          }
        : {}),
      ...doorChanges,
      ...(typeChanges
        ? { type: nextType, collectsAttendeeDetails: nextType === "CAMP" }
        : {}),
    },
  });

  const check = await db.event.findUnique({
    where: { id: event.id },
    select: {
      type: true,
      status: true,
      offersRegistration: true,
      offersVendors: true,
      offersVolunteers: true,
    },
  });
  const ok =
    check?.status === target &&
    check.type === nextType &&
    check.offersRegistration === after.offersRegistration &&
    check.offersVendors === after.offersVendors &&
    check.offersVolunteers === after.offersVolunteers;
  console.log(
    `\n  ${ok ? "ok  " : "FAIL"}  now ${check?.status} ${check?.type}  ` +
      `reg=${check?.offersRegistration} vendors=${check?.offersVendors} ` +
      `vols=${check?.offersVolunteers}`,
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
