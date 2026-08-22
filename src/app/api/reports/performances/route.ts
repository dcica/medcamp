import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentMember } from "@/server/session";
import { ADMIN_ROLES } from "@/server/admin";
import { musicStateFromSlug } from "@/lib/musicState";
import { toCsv } from "@/lib/csv";
import {
  performanceReportRows,
  PERFORMANCE_REPORT_HEADER,
} from "@/server/performance";

/**
 * Competition / showcase roster CSV for one event (?event=<id>), optionally
 * narrowed to one music state (?music=offline|not-sent|received|confirmed) so
 * an export matches the chip the coordinator is looking at — copying the whole
 * roster while "Needs chasing" is on screen is the wrong list, and the same is
 * true of the file version of it.
 *
 * Coordinator / committee-admin only, checked HERE and not merely in the admin
 * layout: a route handler is its own entry point and never renders that layout.
 * The event is re-scoped to the active org before anything is read, so a guessed
 * id from another tenant returns 404 rather than that tenant's contact details.
 */
export async function GET(req: Request) {
  const member = await getCurrentMember();
  if (!member || !(ADMIN_ROLES as readonly string[]).includes(member.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const eventId = params.get("event");
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

  // An unrecognized ?music= means "all", not an error: the chips build this URL,
  // and a stale bookmark should still yield the roster rather than a 400.
  const filter = musicStateFromSlug(params.get("music"));
  const rows = await performanceReportRows(event.id, filter);

  const suffix = filter ? `-${params.get("music")}` : "";
  return new NextResponse(toCsv(PERFORMANCE_REPORT_HEADER, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="performances-${event.code}${suffix}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
