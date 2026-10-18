import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentMember } from "@/server/session";
import { ADMIN_ROLES } from "@/server/admin";
import { toCsv } from "@/lib/csv";
import { ENTRANTS_REPORT_HEADER, getEntrantRows } from "@/server/entrants";

/**
 * Entrants CSV for one event (?event=<id>): division, player, partner, order,
 * email, paid_at — the list a tournament's bracket software is fed from.
 *
 * Coordinator / committee-admin only, checked HERE and not merely in the admin
 * layout: a route handler is its own entry point and never renders that
 * layout. The event is re-scoped to the active organisation before anything
 * is read, so a guessed id from another tenant returns 404 rather than that
 * tenant's names.
 */
export async function GET(req: Request) {
  const member = await getCurrentMember();
  if (!member || !(ADMIN_ROLES as readonly string[]).includes(member.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eventId = new URL(req.url).searchParams.get("event");
  if (!eventId) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }

  const org = await getActiveOrg();
  const event = org
    ? await db.event.findFirst({
        where: { id: eventId, orgId: org.id },
        select: { id: true, code: true },
      })
    : null;
  if (!event) {
    return NextResponse.json({ error: "no such event" }, { status: 404 });
  }

  const rows = await getEntrantRows(org!.id, event.id);
  return new NextResponse(toCsv(ENTRANTS_REPORT_HEADER, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="entrants-${event.code}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
