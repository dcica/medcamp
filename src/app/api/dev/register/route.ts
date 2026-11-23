import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/tenant";
import { createRegistration } from "@/server/registration";

/**
 * DEV-ONLY: create a registration over HTTP (the production path is the server
 * action behind the form). Lets local tests exercise the real code without the
 * server-action wire protocol. Disabled in production.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 404 });
  }
  try {
    const body = await req.json();
    const org = await getActiveOrg();
    if (!org) return NextResponse.json({ ok: false, error: "no organisation" }, { status: 400 });
    const result = await createRegistration(body, { orgId: org.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
