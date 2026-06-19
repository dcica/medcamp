import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Lightweight health/connectivity check. Confirms the app is talking to the
// expected database (org/event counts) and the schema is migrated.
export async function GET() {
  try {
    const [organizations, events, serviceTypes] = await Promise.all([
      db.organization.count(),
      db.event.count(),
      db.serviceType.count(),
    ]);
    return NextResponse.json({
      ok: true,
      db: "connected",
      counts: { organizations, events, serviceTypes },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
