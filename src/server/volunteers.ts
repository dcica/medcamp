import { z } from "zod";
import type {
  SignupStatus,
  VolunteerAgeBand,
  EventType,
  EventStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { getActiveOrg } from "@/lib/tenant";
import { formatVolCode, normalizeVolCode } from "@/lib/volunteerId";
import {
  bandMeetsMinAge,
  isMinorBand,
  normalizeSourceTag,
  sourceLabel,
} from "@/lib/volunteerRoles";
import {
  sendVolunteerSignupEmail,
  sendVolunteerReminderEmail,
  sendVolunteerThankYouEmail,
} from "@/lib/email";

/**
 * Volunteer module service layer (Module 9). Volunteers are platform-level staff,
 * not camp-scoped patients — profiles, hours and school/counselor affiliations
 * persist across events. The headline of this module is the persistent Counselor
 * entity: the school advisor a student submits hours to is captured at signup and
 * accumulates linked students/schools/hours across every event, so the org can
 * reach back to counselors as a recruitment channel. All reads/writes org-scoped.
 */

/** Statuses that occupy a role's capacity (everything except waitlist/cancel). */
const OCCUPYING: SignupStatus[] = [
  "SIGNED_UP",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "NO_SHOW",
];

function confirmUrl(signupId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/volunteer/confirm/${signupId}`;
}
function certUrl(signupId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/volunteer/cert/${signupId}`;
}

/** Hours between sign-in and sign-out, to 0.1h, never negative. */
function computeHours(inAt: Date, outAt: Date): number {
  const ms = outAt.getTime() - inAt.getTime();
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10);
}

/**
 * Resolve the event a volunteer is signing up for. The org can have several
 * volunteer-accepting events open at once (a camp + community events like the
 * 4th of July booth), so the public signup is scoped to a specific event:
 *  - `eventId` (from the ?event= link) → that event, if it's in this org, open,
 *    and offers volunteers.
 *  - no id → default to the ACTIVE one, else the soonest upcoming OPEN one.
 * Camp or general — anything with offersVolunteers qualifies.
 */
export async function resolveVolunteerEvent(eventId?: string) {
  const org = await getActiveOrg();
  if (!org) return null;

  if (eventId) {
    const event = await db.event.findFirst({
      where: {
        id: eventId,
        orgId: org.id,
        offersVolunteers: true,
        status: { in: ["OPEN", "ACTIVE"] },
      },
    });
    return event ? { org, event } : null;
  }

  const event =
    (await db.event.findFirst({
      where: { orgId: org.id, offersVolunteers: true, status: "ACTIVE" },
      orderBy: { startsAt: "asc" },
    })) ??
    (await db.event.findFirst({
      where: { orgId: org.id, offersVolunteers: true, status: "OPEN" },
      orderBy: { startsAt: "asc" },
    }));
  return event ? { org, event } : null;
}

export type VolunteerEventOption = {
  id: string;
  name: string;
  code: string;
  type: EventType;
  status: EventStatus;
  externallyHosted: boolean;
};

/**
 * Every event currently taking volunteers (camp or general, OPEN/ACTIVE) — the
 * coordinator dashboard's event picker. ACTIVE first, then soonest upcoming.
 */
export async function listVolunteerEvents(): Promise<VolunteerEventOption[]> {
  const org = await getActiveOrg();
  if (!org) return [];
  const events = await db.event.findMany({
    where: { orgId: org.id, offersVolunteers: true, status: { in: ["OPEN", "ACTIVE"] } },
    orderBy: [{ status: "asc" }, { startsAt: "asc" }],
  });
  // status enum order puts ACTIVE before OPEN already (OPEN < ACTIVE in the enum
  // declaration), so sort ACTIVE to the front explicitly.
  return events
    .map((e) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      type: e.type,
      status: e.status,
      externallyHosted: e.externallyHosted,
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "ACTIVE" ? -1 : 1));
}

// ── Public signup form data ──────────────────────────────────────────────────

export type RoleOption = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  minAge: number;
  ageGroup: string | null;
  shift: string | null;
  instructions: string | null;
  requiresClearance: boolean;
  capacity: number;
  filled: number;
  isFull: boolean;
};

export type SignupView = {
  eventId: string;
  eventName: string;
  eventCode: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  description: string | null;
  externallyHosted: boolean;
  hostedByName: string | null;
  roles: RoleOption[];
};

export async function getVolunteerSignupView(
  eventId?: string,
): Promise<SignupView | null> {
  const active = await resolveVolunteerEvent(eventId);
  if (!active) return null;
  const { event } = active;

  const roles = await db.volunteerRole.findMany({
    where: { eventId: event.id, active: true },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { signups: { where: { status: { in: OCCUPYING } } } } },
    },
  });

  return {
    eventId: event.id,
    eventName: event.name,
    eventCode: event.code,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    description: event.description,
    externallyHosted: event.externallyHosted,
    hostedByName: event.hostedByName,
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      minAge: r.minAge,
      ageGroup: r.ageGroup,
      shift: r.shift,
      instructions: r.instructions,
      requiresClearance: r.requiresClearance,
      capacity: r.capacity,
      filled: r._count.signups,
      isFull: r.capacity > 0 && r._count.signups >= r.capacity,
    })),
  };
}

// ── Create signup ────────────────────────────────────────────────────────────

export const volunteerSignupSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().min(7, "Phone is required"),
    ageBand: z.enum(["UNDER_16", "AGE_16_17", "AGE_18_PLUS"]),
    school: z.string().optional(),
    skills: z.string().optional(),
    languages: z.string().optional(),
    tshirtSize: z.string().optional(),
    emergencyName: z.string().optional(),
    emergencyPhone: z.string().optional(),
    roleId: z.string().min(1, "Pick a role"),
    // Counselor (required when a school is given or the volunteer is a minor).
    counselorName: z.string().optional(),
    counselorEmail: z.string().optional(),
    counselorTitle: z.string().optional(),
    // Minor consent.
    guardianName: z.string().optional(),
    sourceTag: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const hasSchool = Boolean(v.school && v.school.trim());
    const minor = isMinorBand(v.ageBand);
    if (hasSchool || minor) {
      if (!v.counselorName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counselorName"],
          message: "Counselor / advisor name is required for students.",
        });
      }
      if (!v.counselorEmail?.trim() || !z.string().email().safeParse(v.counselorEmail).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counselorEmail"],
          message: "A valid counselor / advisor email is required for students.",
        });
      }
    }
    if (minor && !v.guardianName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianName"],
        message: "Parent / guardian consent is required for volunteers under 18.",
      });
    }
  });

export type VolunteerSignupInput = z.infer<typeof volunteerSignupSchema>;

export type CreatedSignup = {
  signupId: string;
  code: string;
  status: SignupStatus;
  roleName: string;
  waitlisted: boolean;
};

export async function createVolunteerSignup(
  input: VolunteerSignupInput,
): Promise<CreatedSignup> {
  const data = volunteerSignupSchema.parse(input);
  const org = await getActiveOrg();
  if (!org) throw new Error("Volunteer signups are not open right now.");

  // The role determines the event (one role belongs to exactly one event), so
  // there's no ambiguity when several events are taking volunteers at once.
  const role = await db.volunteerRole.findFirst({
    where: { id: data.roleId, orgId: org.id, active: true },
    include: { event: true },
  });
  if (!role) throw new Error("That role is no longer available.");

  const event = role.event;
  if (!event.offersVolunteers || !["OPEN", "ACTIVE"].includes(event.status)) {
    throw new Error("Volunteer signups are not open for this event.");
  }

  if (!bandMeetsMinAge(data.ageBand, role.minAge)) {
    throw new Error(`This role requires volunteers aged ${role.minAge}+.`);
  }

  // Persistent volunteer profile (deduped per org by email).
  const volunteer = await db.volunteer.upsert({
    where: { orgId_email: { orgId: org.id, email: data.email.toLowerCase() } },
    update: {
      name: data.name,
      phone: data.phone,
      ageBand: data.ageBand as VolunteerAgeBand,
      school: data.school?.trim() || null,
      skills: data.skills?.trim() || null,
      languages: data.languages?.trim() || null,
      tshirtSize: data.tshirtSize?.trim() || null,
      emergencyName: data.emergencyName?.trim() || null,
      emergencyPhone: data.emergencyPhone?.trim() || null,
    },
    create: {
      orgId: org.id,
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone,
      ageBand: data.ageBand as VolunteerAgeBand,
      school: data.school?.trim() || null,
      skills: data.skills?.trim() || null,
      languages: data.languages?.trim() || null,
      tshirtSize: data.tshirtSize?.trim() || null,
      emergencyName: data.emergencyName?.trim() || null,
      emergencyPhone: data.emergencyPhone?.trim() || null,
    },
  });

  // One signup per volunteer per event.
  const existing = await db.volunteerSignup.findUnique({
    where: { volunteerId_eventId: { volunteerId: volunteer.id, eventId: event.id } },
  });
  if (existing && existing.status !== "CANCELLED") {
    throw new Error("You're already signed up for this event.");
  }

  // Persistent counselor (the recruitment asset), deduped per org by email.
  let counselorId: string | null = null;
  if (data.counselorName?.trim() && data.counselorEmail?.trim()) {
    const counselor = await db.counselor.upsert({
      where: {
        orgId_email: { orgId: org.id, email: data.counselorEmail.toLowerCase() },
      },
      update: {
        name: data.counselorName.trim(),
        title: data.counselorTitle?.trim() || undefined,
        school: data.school?.trim() || undefined,
      },
      create: {
        orgId: org.id,
        name: data.counselorName.trim(),
        email: data.counselorEmail.toLowerCase(),
        title: data.counselorTitle?.trim() || null,
        school: data.school?.trim() || null,
      },
    });
    counselorId = counselor.id;
  }

  // Capacity → waitlist if full.
  const filled = await db.volunteerSignup.count({
    where: { roleId: role.id, status: { in: OCCUPYING } },
  });
  const waitlisted = role.capacity > 0 && filled >= role.capacity;
  const status: SignupStatus = waitlisted ? "WAITLISTED" : "SIGNED_UP";

  const signup = await db.$transaction(async (tx) => {
    // Atomically claim a per-event sequence for the QR code.
    const ev = await tx.event.update({
      where: { id: event.id },
      data: { nextVolSeq: { increment: 1 } },
      select: { nextVolSeq: true, code: true },
    });
    const code = formatVolCode(ev.code, ev.nextVolSeq - 1);

    const payload = {
      eventId: event.id,
      roleId: role.id,
      counselorId,
      code,
      status,
      shift: role.shift,
      sourceTag: normalizeSourceTag(data.sourceTag),
      guardianName: data.guardianName?.trim() || null,
      guardianSignedAt: data.guardianName?.trim() ? new Date() : null,
    };

    // Reuse a previously-cancelled signup row if present (unique constraint).
    if (existing) {
      return tx.volunteerSignup.update({
        where: { id: existing.id },
        data: { ...payload, checkedInAt: null, checkedOutAt: null, hoursServed: null },
      });
    }
    return tx.volunteerSignup.create({
      data: { volunteerId: volunteer.id, ...payload },
    });
  });

  // Best-effort acknowledgement email (console fallback in dev).
  try {
    await sendVolunteerSignupEmail({
      to: volunteer.email,
      volunteerName: volunteer.name,
      eventName: event.name,
      roleName: role.name,
      shift: role.shift,
      confirmUrl: confirmUrl(signup.id),
    });
  } catch (err) {
    log.error("volunteer signup email failed", { err });
  }

  return {
    signupId: signup.id,
    code: signup.code!,
    status,
    roleName: role.name,
    waitlisted,
  };
}

// ── Confirmation / cancel ──────────────────────────────────────────────────────

export type ConfirmationView = {
  signupId: string;
  code: string;
  volunteerName: string;
  eventName: string;
  eventCode: string;
  startsAt: Date;
  endsAt: Date;
  roleName: string;
  shift: string | null;
  instructions: string | null;
  status: SignupStatus;
  hoursServed: number | null;
  orgName: string;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
};

async function loadSignup(signupId: string) {
  return db.volunteerSignup.findUnique({
    where: { id: signupId },
    include: { volunteer: true, role: true, event: { include: { org: true } } },
  });
}

export async function getVolunteerConfirmation(
  signupId: string,
): Promise<ConfirmationView | null> {
  const s = await loadSignup(signupId);
  if (!s || !s.code) return null;
  return {
    signupId: s.id,
    code: s.code,
    volunteerName: s.volunteer.name,
    eventName: s.event.name,
    eventCode: s.event.code,
    startsAt: s.event.startsAt,
    endsAt: s.event.endsAt,
    roleName: s.role.name,
    shift: s.shift ?? s.role.shift,
    instructions: s.role.instructions,
    status: s.status,
    hoursServed: s.hoursServed,
    orgName: s.event.org.name,
    checkedInAt: s.checkedInAt,
    checkedOutAt: s.checkedOutAt,
  };
}

/** Volunteer cancels their slot; the oldest waitlister for the role is promoted. */
export async function cancelSignup(signupId: string): Promise<void> {
  const s = await loadSignup(signupId);
  if (!s) throw new Error("Signup not found.");
  if (s.status === "CANCELLED") return;

  await db.$transaction(async (tx) => {
    await tx.volunteerSignup.update({
      where: { id: s.id },
      data: { status: "CANCELLED" },
    });
    // Auto-promote the oldest waitlisted volunteer for the same role.
    const next = await tx.volunteerSignup.findFirst({
      where: { roleId: s.roleId, status: "WAITLISTED" },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await tx.volunteerSignup.update({
        where: { id: next.id },
        data: { status: "SIGNED_UP" },
      });
    }
  });
  log.info("volunteer signup cancelled (coordinator alert)", {
    code: s.code,
    event: s.event.name,
  });
}

// ── Day-of QR sign in / out ────────────────────────────────────────────────────

export type CheckinView = {
  signupId: string;
  code: string;
  volunteerName: string;
  roleName: string;
  shift: string | null;
  instructions: string | null;
  status: SignupStatus;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  hoursServed: number | null;
};

export async function getVolunteerByCode(
  rawCode: string,
): Promise<CheckinView | null> {
  const code = normalizeVolCode(rawCode) ?? rawCode.trim().toUpperCase();
  const org = await getActiveOrg();
  if (!org) return null;
  const s = await db.volunteerSignup.findFirst({
    where: { code, event: { orgId: org.id } },
    include: { volunteer: true, role: true },
  });
  if (!s) return null;
  return {
    signupId: s.id,
    code: s.code!,
    volunteerName: s.volunteer.name,
    roleName: s.role.name,
    shift: s.shift ?? s.role.shift,
    instructions: s.role.instructions,
    status: s.status,
    checkedInAt: s.checkedInAt,
    checkedOutAt: s.checkedOutAt,
    hoursServed: s.hoursServed,
  };
}

async function findSignupByCodeOrThrow(rawCode: string) {
  const code = normalizeVolCode(rawCode) ?? rawCode.trim().toUpperCase();
  const org = await getActiveOrg();
  if (!org) throw new Error("No active org.");
  const s = await db.volunteerSignup.findFirst({
    where: { code, event: { orgId: org.id } },
  });
  if (!s) throw new Error("No volunteer matches that code.");
  return s;
}

export async function signInVolunteer(rawCode: string): Promise<void> {
  const s = await findSignupByCodeOrThrow(rawCode);
  if (s.checkedInAt) return; // idempotent
  await db.volunteerSignup.update({
    where: { id: s.id },
    data: { status: "CHECKED_IN", checkedInAt: new Date() },
  });
}

export async function signOutVolunteer(rawCode: string): Promise<void> {
  const s = await findSignupByCodeOrThrow(rawCode);
  if (!s.checkedInAt) throw new Error("Volunteer must sign in before signing out.");
  if (s.checkedOutAt) return; // idempotent
  const out = new Date();
  await db.volunteerSignup.update({
    where: { id: s.id },
    data: {
      status: "CHECKED_OUT",
      checkedOutAt: out,
      hoursServed: computeHours(s.checkedInAt, out),
    },
  });
}

/** Org-scoped guard before mutating a signup by id (coordinator actions). */
async function ownedSignup(signupId: string) {
  const org = await getActiveOrg();
  if (!org) return null;
  return db.volunteerSignup.findFirst({
    where: { id: signupId, event: { orgId: org.id } },
  });
}

export async function setHours(signupId: string, hours: number): Promise<void> {
  const s = await ownedSignup(signupId);
  if (!s) throw new Error("Signup not found.");
  await db.volunteerSignup.update({
    where: { id: s.id },
    data: { hoursServed: Math.max(0, hours) },
  });
}

export async function markNoShow(signupId: string): Promise<void> {
  const s = await ownedSignup(signupId);
  if (!s) throw new Error("Signup not found.");
  await db.volunteerSignup.update({
    where: { id: s.id },
    data: { status: "NO_SHOW" },
  });
}

// ── Coordinator roster ─────────────────────────────────────────────────────────

export type RosterRow = {
  signupId: string;
  code: string | null;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  status: SignupStatus;
  shift: string | null;
  school: string | null;
  counselorName: string | null;
  sourceTag: string | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  hoursServed: number | null;
};

export type VolunteerRoster = {
  eventId: string;
  eventName: string;
  summary: {
    total: number; // not cancelled
    waitlisted: number;
    onSite: number; // checked in, not out
    checkedOut: number;
    noShow: number;
  };
  roles: { id: string; name: string; capacity: number; filled: number; shift: string | null }[];
  bySource: { tag: string; label: string; count: number }[];
  rows: RosterRow[];
};

export async function getVolunteerRoster(
  eventId?: string,
): Promise<VolunteerRoster | null> {
  const active = await resolveVolunteerEvent(eventId);
  if (!active) return null;
  const { event } = active;

  const [roles, signups] = await Promise.all([
    db.volunteerRole.findMany({
      where: { eventId: event.id },
      orderBy: { name: "asc" },
    }),
    db.volunteerSignup.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      include: { volunteer: true, role: true, counselor: true },
    }),
  ]);

  const filledByRole = new Map<string, number>();
  for (const s of signups) {
    if (OCCUPYING.includes(s.status)) {
      filledByRole.set(s.roleId, (filledByRole.get(s.roleId) ?? 0) + 1);
    }
  }

  const bySourceMap = new Map<string, number>();
  for (const s of signups) {
    if (s.status === "CANCELLED") continue;
    const tag = s.sourceTag ?? "direct";
    bySourceMap.set(tag, (bySourceMap.get(tag) ?? 0) + 1);
  }

  return {
    eventId: event.id,
    eventName: event.name,
    summary: {
      total: signups.filter((s) => s.status !== "CANCELLED").length,
      waitlisted: signups.filter((s) => s.status === "WAITLISTED").length,
      onSite: signups.filter((s) => s.status === "CHECKED_IN").length,
      checkedOut: signups.filter((s) => s.status === "CHECKED_OUT").length,
      noShow: signups.filter((s) => s.status === "NO_SHOW").length,
    },
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      filled: filledByRole.get(r.id) ?? 0,
      shift: r.shift,
    })),
    bySource: [...bySourceMap.entries()].map(([tag, count]) => ({
      tag,
      label: sourceLabel(tag),
      count,
    })),
    rows: signups.map((s) => ({
      signupId: s.id,
      code: s.code,
      name: s.volunteer.name,
      email: s.volunteer.email,
      phone: s.volunteer.phone,
      roleId: s.roleId,
      roleName: s.role.name,
      status: s.status,
      shift: s.shift ?? s.role.shift,
      school: s.volunteer.school,
      counselorName: s.counselor?.name ?? null,
      sourceTag: s.sourceTag,
      checkedInAt: s.checkedInAt,
      checkedOutAt: s.checkedOutAt,
      hoursServed: s.hoursServed,
    })),
  };
}

// ── Counselor rollup (the recruitment view) ─────────────────────────────────────

export type CounselorRollup = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  school: string | null;
  students: number; // distinct volunteers linked
  events: number; // distinct events
  totalHours: number; // verified hours across their students
};

export async function getCounselorRollup(): Promise<CounselorRollup[]> {
  const org = await getActiveOrg();
  if (!org) return [];
  const counselors = await db.counselor.findMany({
    where: { orgId: org.id },
    orderBy: { name: "asc" },
    include: {
      signups: {
        where: { status: { not: "CANCELLED" } },
        select: { volunteerId: true, eventId: true, hoursServed: true },
      },
    },
  });
  return counselors
    .map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title,
      school: c.school,
      students: new Set(c.signups.map((s) => s.volunteerId)).size,
      events: new Set(c.signups.map((s) => s.eventId)).size,
      totalHours: c.signups.reduce((sum, s) => sum + (s.hoursServed ?? 0), 0),
    }))
    .filter((c) => c.students > 0);
}

// ── Reminders + certificates ─────────────────────────────────────────────────

/** Send the 24–48h reminder to everyone not yet checked in. Returns count sent. */
export async function sendReminders(eventId?: string): Promise<number> {
  const active = await resolveVolunteerEvent(eventId);
  if (!active) return 0;
  const { event } = active;
  const signups = await db.volunteerSignup.findMany({
    where: { eventId: event.id, status: { in: ["SIGNED_UP", "CONFIRMED"] } },
    include: { volunteer: true, role: true },
  });
  for (const s of signups) {
    try {
      await sendVolunteerReminderEmail({
        to: s.volunteer.email,
        volunteerName: s.volunteer.name,
        eventName: event.name,
        roleName: s.role.name,
        shift: s.shift ?? s.role.shift,
        instructions: s.role.instructions,
        confirmUrl: confirmUrl(s.id),
      });
    } catch (err) {
      log.error("volunteer reminder email failed", { err });
    }
  }
  return signups.length;
}

/** Batch-issue certificates + thank-you emails to checked-out volunteers. */
export async function issueCertificates(eventId?: string): Promise<number> {
  const active = await resolveVolunteerEvent(eventId);
  if (!active) return 0;
  const { event } = active;
  const signups = await db.volunteerSignup.findMany({
    where: {
      eventId: event.id,
      status: "CHECKED_OUT",
      certificateIssuedAt: null,
    },
    include: { volunteer: true },
  });
  for (const s of signups) {
    await db.volunteerSignup.update({
      where: { id: s.id },
      data: { certificateIssuedAt: new Date() },
    });
    try {
      await sendVolunteerThankYouEmail({
        to: s.volunteer.email,
        volunteerName: s.volunteer.name,
        eventName: event.name,
        hoursServed: s.hoursServed,
        certUrl: certUrl(s.id),
      });
    } catch (err) {
      log.error("volunteer thank-you email failed", { err });
    }
  }
  return signups.length;
}

// ── CSV report rows ──────────────────────────────────────────────────────────

export async function getVolunteerReportRows(eventId?: string) {
  const active = await resolveVolunteerEvent(eventId);
  if (!active) return { eventCode: null as string | null, rows: [] };
  const { event } = active;
  const signups = await db.volunteerSignup.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "asc" },
    include: { volunteer: true, role: true, counselor: true },
  });
  return {
    eventCode: event.code,
    rows: signups.map((s) => ({
      code: s.code ?? "",
      name: s.volunteer.name,
      email: s.volunteer.email,
      phone: s.volunteer.phone ?? "",
      role: s.role.name,
      status: s.status,
      shift: s.shift ?? s.role.shift ?? "",
      school: s.volunteer.school ?? "",
      counselorName: s.counselor?.name ?? "",
      counselorEmail: s.counselor?.email ?? "",
      source: sourceLabel(s.sourceTag),
      hoursServed: s.hoursServed ?? "",
    })),
  };
}

export async function getCounselorReportRows() {
  const rollup = await getCounselorRollup();
  return rollup.map((c) => ({
    name: c.name,
    email: c.email,
    title: c.title ?? "",
    school: c.school ?? "",
    students: c.students,
    events: c.events,
    totalHours: c.totalHours.toFixed(1),
  }));
}
