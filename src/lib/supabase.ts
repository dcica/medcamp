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
 * Derive the public-object URL prefix from a Supabase project URL. Pure, so the
 * verify suite can pin the derivation itself rather than only its env-dependent
 * wrapper — which could otherwise be broken to return null unconditionally,
 * killing every tenant logo in every environment, with the suite still green.
 *
 * Returns null for anything that is not an https URL.
 */
export function publicObjectPrefixFor(
  supabaseUrl: string | undefined | null,
): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:") return null;
    // `url.host`, not `url.hostname`: it carries a non-default port when the
    // project URL has one, so the prefix cannot admit a different port than the
    // configured project. NOTE this is deliberately NOT identical to
    // next.config.mjs, which uses `hostname` and omits `port` and therefore
    // matches only the DEFAULT port. For a self-hoster on, say, :8443 the two
    // disagree: this function would admit the URL and next/image would 400 it.
    // The direction is the safe one (never looser than the real host) and the
    // outcome is a broken image rather than an outbound request to a host we did
    // not intend, but they are not byte-for-byte the same rule and the comment
    // below should not be read as claiming they are.
    return `https://${url.host}/storage/v1/object/public/`;
  } catch {
    return null;
  }
}

/**
 * The one URL prefix under which stored asset URLs are allowed to live —
 * `https://<project>.supabase.co/storage/v1/object/public/`.
 *
 * Mirrors the allowlist next.config.mjs gives next/image (that host, that
 * pathname prefix), derived from the same env var rather than hardcoded, so
 * test, prod and a self-hoster's own project each admit their own host and
 * nothing else. It lives here, next to the client that owns the URL, so callers
 * cannot drift from what the image config permits. (See the port caveat above.)
 *
 * Returns null when Supabase is unconfigured (local Docker dev), in which case
 * no offsite asset URL is admissible at all — only same-origin paths.
 */
export function supabasePublicObjectPrefix(): string | null {
  return publicObjectPrefixFor(env.NEXT_PUBLIC_SUPABASE_URL);
}
