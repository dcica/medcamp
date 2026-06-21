import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";

/**
 * Station queue + routing engine (Module 3). A patient's route is their ordered
 * StationVisit rows; their CURRENT station is the lowest-sequence visit that
 * isn't DONE. A station's live queue is everyone whose current station is this
 * one. Completing a visit auto-advances the patient (no explicit "move" — the
 * next non-DONE visit simply becomes current). All reads/writes are org-scoped.
 */

/**
 * The camp staff are working right now: ACTIVE if any, else the OPEN one.
 * Scoped to type CAMP so a concurrently-ACTIVE general event (e.g. a dandia
 * gate, resolved separately by the gate) never shadows the medcamp.
 */
export async function getActiveCamp(orgId: string) {
  return (
    (await db.event.findFirst({
      where: { orgId, type: "CAMP", status: "ACTIVE" },
    })) ??
    (await db.event.findFirst({
      where: { orgId, type: "CAMP", status: "OPEN" },
    }))
  );
}

export type QueueEntry = {
  visitId: string;
  attendeeId: string;
  campId: string;
  name: string | null;
  status: "QUEUED" | "IN_PROGRESS";
  checkedInAt: Date | null;
  enteredAt: Date | null;
  needsPayment: boolean;
  services: { name: string; colorHex: string }[];
};

export type StationQueue = {
  campName: string;
  stationName: string;
  stationKey: string;
  inProgress: QueueEntry[];
  waiting: QueueEntry[];
};

export async function getStationQueue(
  stationKey: string,
): Promise<StationQueue | null> {
  const org = await getActiveOrg();
  if (!org) return null;
  const camp = await getActiveCamp(org.id);
  if (!camp) return null;

  const station = await db.station.findUnique({
    where: { eventId_key: { eventId: camp.id, key: stationKey } },
  });
  if (!station) return null;

  const attendees = await db.attendee.findMany({
    where: { eventId: camp.id, checkedInAt: { not: null } },
    include: {
      stationVisits: true,
      lineItems: { include: { serviceType: true } },
    },
  });

  const entries: QueueEntry[] = [];
  for (const a of attendees) {
    const nonDone = a.stationVisits
      .filter((v) => v.status !== "DONE")
      .sort((x, y) => x.sequence - y.sequence);
    const current = nonDone[0];
    if (!current || current.stationId !== station.id) continue;

    entries.push({
      visitId: current.id,
      attendeeId: a.id,
      campId: a.campId!,
      name: a.name,
      status: current.status === "IN_PROGRESS" ? "IN_PROGRESS" : "QUEUED",
      checkedInAt: a.checkedInAt,
      enteredAt: current.enteredAt,
      needsPayment: a.lineItems.some(
        (li) => li.addedOnsite && li.status === "PENDING_PAYMENT",
      ),
      services: a.lineItems.map((li) => ({
        name: li.serviceType?.name ?? li.description,
        colorHex: li.serviceType?.colorHex ?? "#888888",
      })),
    });
  }

  // FIFO by check-in time within each bucket.
  const byArrival = (x: QueueEntry, y: QueueEntry) =>
    (x.checkedInAt?.getTime() ?? 0) - (y.checkedInAt?.getTime() ?? 0);

  return {
    campName: camp.name,
    stationName: station.name,
    stationKey: station.key,
    inProgress: entries.filter((e) => e.status === "IN_PROGRESS").sort(byArrival),
    waiting: entries.filter((e) => e.status === "QUEUED").sort(byArrival),
  };
}

/** Verify a visit belongs to the active org before mutating it. */
async function ownedVisit(visitId: string) {
  const org = await getActiveOrg();
  if (!org) return null;
  return db.stationVisit.findFirst({
    where: { id: visitId, attendee: { orgId: org.id } },
  });
}

export async function startVisit(visitId: string): Promise<void> {
  const visit = await ownedVisit(visitId);
  if (!visit) throw new Error("Visit not found.");
  if (visit.status === "DONE") return;
  await db.stationVisit.update({
    where: { id: visit.id },
    data: { status: "IN_PROGRESS", enteredAt: visit.enteredAt ?? new Date() },
  });
}

/** Complete a visit; the patient auto-advances to their next station. */
export async function completeVisit(visitId: string): Promise<void> {
  const visit = await ownedVisit(visitId);
  if (!visit) throw new Error("Visit not found.");
  if (visit.status === "DONE") return;
  await db.stationVisit.update({
    where: { id: visit.id },
    data: { status: "DONE", doneAt: new Date() },
  });
}

/**
 * Doctor add-on mid-visit: adds a billable service as a PENDING_PAYMENT line
 * item flagged addedOnsite. The patient is then flagged needs_payment and sent
 * to the registration desk (onsite payment collection is a separate POS flow).
 */
export async function addOnsiteService(
  attendeeId: string,
  serviceTypeId: string,
): Promise<void> {
  const org = await getActiveOrg();
  if (!org) throw new Error("No active org.");

  const attendee = await db.attendee.findFirst({
    where: { id: attendeeId, orgId: org.id },
  });
  if (!attendee) throw new Error("Attendee not found.");

  const service = await db.serviceType.findFirst({
    where: { id: serviceTypeId, orgId: org.id },
  });
  if (!service) throw new Error("Service not found.");

  await db.lineItem.create({
    data: {
      orgId: org.id,
      orderId: attendee.orderId,
      attendeeId: attendee.id,
      serviceTypeId: service.id,
      description: `${service.name} — ${attendee.name ?? attendee.campId} (added on-site)`,
      amountCents: service.priceCents,
      status: "PENDING_PAYMENT",
      addedOnsite: true,
    },
  });
}

/** Services a doctor can add on-site (active org menu). */
export async function addableServices() {
  const org = await getActiveOrg();
  if (!org) return [];
  return db.serviceType.findMany({
    where: { orgId: org.id, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, priceCents: true },
  });
}

/** Active stations for the current camp (the station picker). */
export async function getActiveCampStations() {
  const org = await getActiveOrg();
  if (!org) return { campName: null, stations: [] };
  const camp = await getActiveCamp(org.id);
  if (!camp) return { campName: null, stations: [] };
  const stations = await db.station.findMany({
    where: { eventId: camp.id, active: true },
    orderBy: { sequence: "asc" },
  });
  return {
    campName: camp.name,
    stations: stations.map((s) => ({
      key: s.key,
      name: s.name,
      colorHex: s.colorHex,
    })),
  };
}
