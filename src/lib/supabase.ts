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

/**
 * The one URL prefix under which stored asset URLs are allowed to live —
 * `https://<project>.supabase.co/storage/v1/object/public/`.
 *
 * This is the SAME allowlist next.config.mjs gives next/image (that host, that
 * pathname prefix), derived from the same env var rather than hardcoded, so
 * test, prod and a self-hoster's own project each admit their own host and
 * nothing else. It lives here, next to the client that owns the URL, so callers
 * cannot drift from what the image config actually permits.
 *
 * Returns null when Supabase is unconfigured (local Docker dev), in which case
 * no offsite asset URL is admissible at all — only same-origin paths.
 */
export function supabasePublicObjectPrefix(): string | null {
  if (!env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:") return null;
    return `https://${url.host}/storage/v1/object/public/`;
  } catch {
    return null;
  }
}
