import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/session";
import { getCounselorReportRows } from "@/server/volunteers";

/**
 * Counselor contact + rollup CSV — the recruitment list. Lists every school
 * advisor captured at signup with their linked-student count, events, and total
 * verified hours, so the org can reach back before the next event. Managers only.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (
    !member ||
    !["COORDINATOR", "COMMITTEE_ADMIN", "VOLUNTEER_COORDINATOR"].includes(member.role)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await getCounselorReportRows();

  const header = [
    "name",
    "email",
    "title",
    "school",
    "students",
    "events",
    "total_hours",
  ];
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [r.name, r.email, r.title, r.school, r.students, r.events, r.totalHours]
        .map((v) => escape(String(v)))
        .join(","),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="counselors.csv"`,
    },
  });
}

export const dynamic = "force-dynamic";
