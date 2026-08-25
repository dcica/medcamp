import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * Lightweight health/connectivity check. Confirms the app is talking to a
 * migrated database and can read it.
 *
 * THIS ENDPOINT IS UNAUTHENTICATED, so what it says is public. It used to return
 * `err.message` verbatim, which for a Prisma connection failure is
 * `Can't reach database server at <host>:<port>` — the Supabase hostname handed
 * to anyone who asked while the database was down. It also returned org, event
 * and service-type counts, which is the tenant's size and event volume.
 *
 * Both are gone. The detail still exists, in the runtime log, where it is useful
 * to the person deploying and not to a stranger. `seeded` is the one bit the
 * deploy runbook actually needs (.claude/skills/deploy/SKILL.md verifies the app
 * is pointed at a populated database, not at an empty `public` schema — the
 * schema-separation footgun); a boolean answers that without publishing counts.
 */
export async function GET() {
  try {
    const [organizations, events] = await Promise.all([
      db.organization.count(),
      db.event.count(),
    ]);
    return NextResponse.json({
      ok: true,
      db: "connected",
      seeded: organizations > 0 && events > 0,
    });
  } catch (err) {
    // Logged, not returned: see the note above.
    log.error("health: database read failed", { err });
    return NextResponse.json({ ok: false, db: "unreachable" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
