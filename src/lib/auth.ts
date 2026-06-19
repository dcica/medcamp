import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import AzureADProvider from "next-auth/providers/azure-ad";
import { db } from "@/lib/db";
import { env, enabledOidcProviders } from "@/lib/env";

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
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
};
