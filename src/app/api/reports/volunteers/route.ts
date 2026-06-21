import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/session";
import { getVolunteerReportRows } from "@/server/volunteers";

/**
 * Volunteer roster CSV for the active event. Volunteer-module managers only
 * (server-side role check, not just middleware).
 */
export async function GET() {
  const member = await getCurrentMember();
  if (
    !member ||
    !["COORDINATOR", "COMMITTEE_ADMIN", "VOLUNTEER_COORDINATOR"].includes(member.role)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { eventCode, rows } = await getVolunteerReportRows();
  if (!eventCode) {
    return NextResponse.json({ error: "no active event" }, { status: 404 });
  }

  const header = [
    "code",
    "name",
    "email",
    "phone",
    "role",
    "status",
    "shift",
    "school",
    "counselor_name",
    "counselor_email",
    "source",
    "hours_served",
  ];
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.code,
        r.name,
        r.email,
        r.phone,
        r.role,
        r.status,
        r.shift,
        r.school,
        r.counselorName,
        r.counselorEmail,
        r.source,
        String(r.hoursServed),
      ]
        .map((v) => escape(String(v)))
        .join(","),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="volunteers-${eventCode}.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
