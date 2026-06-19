import type { DefaultSession } from "next-auth";

// Augment the session so `session.user.id` is typed (database-session strategy
// exposes the adapter user id). Role/org are NOT put on the session — they are
// tenant-scoped and resolved per request via getCurrentMember().
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
