import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";

/**
 * DEV-ONLY: sign in as a member without OIDC, for local testing of the authz
 * layer. Creates/updates the user + membership, mints a database Session row,
 * and sets the NextAuth session cookie. Disabled in production.
 *
 * POST /api/dev/login  body: { email?, role?, canHoldTill? }
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const email: string = body.email ?? "coordinator@dcica.test";
  const role: Role = body.role ?? "COORDINATOR";
  const canHoldTill: boolean = body.canHoldTill ?? role === "COORDINATOR";

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: "no active org (seed first)" }, { status: 400 });
  }

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  });

  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: { role, canHoldTill },
    create: { orgId: org.id, userId: user.id, role, canHoldTill },
  });

  const sessionToken = `${randomUUID()}${randomUUID()}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const res = NextResponse.json({
    ok: true,
    email,
    role,
    canHoldTill,
    orgId: org.id,
  });
  res.cookies.set("next-auth.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return res;
}
