import { NextRequest, NextResponse } from "next/server";
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
    const result = await createRegistration(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
