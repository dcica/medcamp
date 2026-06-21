import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getActiveOrg } from "@/lib/tenant";
import {
  testLoginEnabled,
  testLoginPassword,
  findTestAccount,
} from "@/lib/testAccounts";

/**
 * TEST-ONLY credential login. Gated by TEST_LOGIN_ENABLED (config entry), NOT by
 * NODE_ENV — so it can be turned on in a preview/staging deploy for testing and
 * stays off in production. Validates a shared password, then mints a NextAuth
 * database session for the requested test account's role.
 *
 * POST /api/test-login  body: { username, password }
 */
export async function POST(req: NextRequest) {
  if (!testLoginEnabled) {
    return NextResponse.json({ error: "test login disabled" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const username: string = (body.username ?? "").toString();
  const password: string = (body.password ?? "").toString();

  const account = findTestAccount(username);
  if (!account || password !== testLoginPassword) {
    // Same message either way — don't reveal which half was wrong.
    return NextResponse.json(
      { error: "Invalid test username or password." },
      { status: 401 },
    );
  }

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json(
      { error: "No active org — run the seed first." },
      { status: 400 },
    );
  }

  const user = await db.user.upsert({
    where: { email: account.email },
    update: { name: account.label },
    create: { email: account.email, name: account.label },
  });

  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {
      role: account.role,
      canHoldTill: account.canHoldTill,
      canOverrideWaiver: account.canOverrideWaiver,
    },
    create: {
      orgId: org.id,
      userId: user.id,
      role: account.role,
      canHoldTill: account.canHoldTill,
      canOverrideWaiver: account.canOverrideWaiver,
    },
  });

  const sessionToken = `${randomUUID()}${randomUUID()}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.session.create({ data: { sessionToken, userId: user.id, expires } });

  const res = NextResponse.json({
    ok: true,
    username: account.username,
    role: account.role,
  });
  // Match NextAuth's cookie naming, or getServerSession won't find this session.
  // Over HTTPS (prod/Vercel) NextAuth uses the "__Secure-" prefixed, Secure
  // cookie; on plain http (local dev) it uses the bare name. Picking the wrong
  // one means middleware passes (it checks both) but the page-level session
  // lookup fails and bounces to /login.
  const useSecureCookie =
    (env.NEXTAUTH_URL ?? "").startsWith("https://") || Boolean(process.env.VERCEL);
  const cookieName = useSecureCookie
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  res.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
    secure: useSecureCookie,
  });
  return res;
}
