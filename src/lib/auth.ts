import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import AzureADProvider from "next-auth/providers/azure-ad";
import { db } from "@/lib/db";
import { env, enabledOidcProviders } from "@/lib/env";
import { getActiveOrg } from "@/lib/tenant";

/**
 * OIDC-first auth (CLAUDE.md). Only configured providers are offered — the env
 * layer decides which. Roles are tenant-scoped via Membership, resolved per
 * request rather than baked into the session token (a user may span orgs).
 */
const providers: NextAuthOptions["providers"] = [];

if (enabledOidcProviders.google) {
  providers.push(
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    }),
  );
}
if (enabledOidcProviders.github) {
  providers.push(
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!,
    }),
  );
}
if (enabledOidcProviders.microsoft) {
  providers.push(
    AzureADProvider({
      clientId: env.MICROSOFT_CLIENT_ID!,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers,
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    /**
     * Grant access on first sign-in. Two sources, in order:
     *   1. BOOTSTRAP_ADMIN_EMAILS → COORDINATOR (bootstrap the first admin).
     *   2. A pending Invite (created by a coordinator in the admin portal) →
     *      membership from the invite's role + capability flags.
     * Without this, OIDC login succeeds but the user has no Membership = no access.
     */
    async signIn({ user }) {
      if (!user.email) return;
      const org = await getActiveOrg();
      if (!org) return;

      const email = user.email.toLowerCase();

      // Already a member — nothing to grant.
      const existing = await db.membership.findUnique({
        where: { orgId_userId: { orgId: org.id, userId: user.id } },
      });
      if (existing) return;

      // 1. Bootstrap admins.
      const admins = (env.BOOTSTRAP_ADMIN_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (admins.includes(email)) {
        await db.membership.create({
          data: {
            orgId: org.id,
            userId: user.id,
            role: "COORDINATOR",
            canHoldTill: true,
          },
        });
        return;
      }

      // 2. Pending invite.
      const invite = await db.invite.findUnique({
        where: { orgId_email: { orgId: org.id, email } },
      });
      if (invite && !invite.acceptedAt) {
        await db.$transaction([
          db.membership.create({
            data: {
              orgId: org.id,
              userId: user.id,
              role: invite.role,
              canHoldTill: invite.canHoldTill,
              canOverrideWaiver: invite.canOverrideWaiver,
            },
          }),
          db.invite.update({
            where: { id: invite.id },
            data: { acceptedAt: new Date() },
          }),
        ]);
      }
    },
  },
};
