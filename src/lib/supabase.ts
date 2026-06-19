import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Browser-safe Supabase client — used ONLY for Realtime (queue depths, station
 * boards) per decision #6. All authoritative writes go through Prisma/server
 * actions, never this client. Returns null when Supabase isn't configured so
 * Realtime degrades to polling rather than crashing.
 */
export function createRealtimeClient() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { realtime: { params: { eventsPerSecond: 5 } } },
  );
}
