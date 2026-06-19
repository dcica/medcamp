import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { parseCampId } from "@/lib/campId";

/**
 * Check-in service (Module 2). All reads/writes are scoped to the active org
 * (app-layer tenant isolation — RLS deferred per Approach C). Check-in is the
 * gate into the patient flow: verify registered + PAID, capture waiver, stamp
 * arrival, and close the check-in station visit so the route can advance.
 */

export type CheckinView = {
  attendeeId: string;
  campId: string;
  name: string | null;
  eventName: string;
  isPaid: boolean;
  waiverSigned: boolean;
  checkedInAt: Date | null;
  services: { name: string; colorHex: string }[];
};

/** Look up an attendee by campId within the active org. Null if not found. */
export async function getAttendeeForCheckin(
  rawCampId: string,
): Promise<CheckinView | null> {
  const org = await getActiveOrg();
  if (!org) return null;

  // Normalize scanned/typed input (case, whitespace) before matching.
  const parsed = parseCampId(rawCampId);
  const campId = parsed
    ? `${parsed.eventCode}-${parsed.sequence.toString().padStart(4, "0")}`
    : rawCampId.trim().toUpperCase();

  const attendee = await db.attendee.findFirst({
    where: { orgId: org.id, campId },
    include: {
      event: true,
      order: true,
      lineItems: { include: { serviceType: true } },
    },
  });
  if (!attendee) return null;

  return {
    attendeeId: attendee.id,
    campId: attendee.campId!,
    name: attendee.name,
    eventName: attendee.event.name,
    isPaid: attendee.order.status === "CONFIRMED",
    waiverSigned: attendee.waiverSigned,
    checkedInAt: attendee.checkedInAt,
    services: attendee.lineItems.map((li) => ({
      name: li.serviceType?.name ?? li.description,
      colorHex: li.serviceType?.colorHex ?? "#888888",
    })),
  };
}

export type BadgeData = {
  campId: string;
  name: string | null;
  eventName: string;
  services: { name: string; colorHex: string }[];
  /** Station route in order — the badge checklist. */
  route: { name: string }[];
};

/** Load everything needed to render/print a badge, scoped to the active org. */
export async function getBadge(rawCampId: string): Promise<BadgeData | null> {
  const org = await getActiveOrg();
  if (!org) return null;
  const campId = rawCampId.trim().toUpperCase();

  const attendee = await db.attendee.findFirst({
    where: { orgId: org.id, campId },
    include: {
      event: true,
      lineItems: { include: { serviceType: true } },
      stationVisits: {
        include: { station: true },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!attendee) return null;

  return {
    campId: attendee.campId!,
    name: attendee.name,
    eventName: attendee.event.name,
    services: attendee.lineItems.map((li) => ({
      name: li.serviceType?.name ?? li.description,
      colorHex: li.serviceType?.colorHex ?? "#888888",
    })),
    route: attendee.stationVisits.map((v) => ({ name: v.station.name })),
  };
}

async function findAttendeeOrThrow(campId: string) {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active organization.");
  const normalized = campId.trim().toUpperCase();
  const attendee = await db.attendee.findFirst({
    where: { orgId: org.id, campId: normalized },
    include: { order: true },
  });
  if (!attendee) throw new Error(`No attendee found for ${normalized}.`);
  return attendee;
}

/** Record the digital waiver signature. Idempotent. */
export async function signWaiver(campId: string): Promise<void> {
  const attendee = await findAttendeeOrThrow(campId);
  if (attendee.waiverSigned) return;
  await db.attendee.update({
    where: { id: attendee.id },
    data: { waiverSigned: true, waiverSignedAt: new Date() },
  });
}

/**
 * Check the attendee in: requires a confirmed (paid) order and a signed waiver.
 * Stamps checkedInAt and closes the "checkin" station visit so the route can
 * advance (Module 3 drives the rest). Idempotent — re-checking-in is a no-op.
 */
export async function checkInAttendee(campId: string): Promise<void> {
  const attendee = await findAttendeeOrThrow(campId);

  if (attendee.checkedInAt) return; // already checked in

  if (attendee.order.status !== "CONFIRMED") {
    throw new Error("Payment not confirmed — send to registration desk.");
  }
  if (!attendee.waiverSigned) {
    throw new Error("Waiver must be signed before check-in.");
  }

  await db.$transaction(async (tx) => {
    await tx.attendee.update({
      where: { id: attendee.id },
      data: { checkedInAt: new Date() },
    });
    // Close the check-in station visit (route advances from here).
    await tx.stationVisit.updateMany({
      where: {
        attendeeId: attendee.id,
        station: { key: "checkin" },
      },
      data: { status: "DONE", doneAt: new Date() },
    });
  });
}
