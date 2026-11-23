import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/tenant";
import { getCurrentMember } from "@/server/session";
import { ADMIN_ROLES } from "@/server/admin";
import { toCsv } from "@/lib/csv";
import { DONORS_REPORT_HEADER, getDonorRows } from "@/server/donations";

/**
 * The year-end donor list as CSV (?year=YYYY, default this year): date,
 * donor, email, amount_usd, event ("general" for a gift on /donate), honoree,
 * order. Money received only — see getDonorRows.
 *
 * Coordinator / committee-admin only, checked HERE: a route handler is its
 * own entry point and never renders the admin layout. Scoped to the active
 * organisation before anything is read.
 */
export async function GET(req: Request) {
  const member = await getCurrentMember();
  if (!member || !(ADMIN_ROLES as readonly string[]).includes(member.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "no organisation" }, { status: 404 });

  const raw = new URL(req.url).searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : new Date().getFullYear();
  const rows = await getDonorRows(org.id, { year });

  return new NextResponse(toCsv(DONORS_REPORT_HEADER, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="donations-${year}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
