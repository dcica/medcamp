import type { NextAuthOptions } from "next-auth";
import type { PrismaClient } from "@prisma/client";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import AzureADProvider from "next-auth/providers/azure-ad";
import { db } from "@/lib/db";
import { env, enabledOidcProviders } from "@/lib/env";
import { getActiveOrg } from "@/lib/tenant";
import { grantOnSignIn } from "@/server/staffOrg";

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
  // THE CAST IS LOAD-BEARING AND IT IS SAFE. `db` declares a client-level
  // `omit` (src/lib/db.ts), which makes its type `PrismaClient<{ omit: ... }>`
  // rather than the bare `PrismaClient` this adapter's signature asks for —
  // the generic carries the result shapes, so the two are not assignable even
  // though the runtime object is the same one. The adapter touches only User,
  // Account, Session and VerificationToken; it never reads Event, so nothing it
  // does is affected by which Event columns are withheld.
  //
  // Do NOT "fix" this by widening `db`'s own type back to `PrismaClient`. That
  // would restore `internalNotes` to every event result type while the runtime
  // kept withholding it — the failure mode being a field that type-checks
  // everywhere and is undefined at runtime.
  adapter: PrismaAdapter(db as unknown as PrismaClient),
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
      // ONE function, in staffOrg.ts, so the suite can call it with an
      // organisation resolved or not: pending invites everywhere first, then
      // the bootstrap admin on the resolved organisation.
      await grantOnSignIn(user.id, user.email.toLowerCase(), await getActiveOrg());
    },
  },
};
