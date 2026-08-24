import { config } from "dotenv";

// Force this project's .env to win over any inherited shell variables (e.g. a
// machine-global DATABASE_URL belonging to another project). dotenv normally
// won't override an already-set var, so we pass override:true. next.config runs
// before the server modules evaluate, so the corrected values reach Prisma.
config({ override: true });

// Event banners are uploaded to Supabase Storage, so next/image must be told the
// host is allowed — otherwise every poster 400s. Derived from the same env var
// the storage client uses rather than hardcoded, so test and prod (and a
// self-hoster's own Supabase) each allow their own host and nothing else.
const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev-only Next badge is OFF, and this is a phone-first consequence rather
  // than a preference. Every screen here puts a 48px primary button at the
  // bottom of the card or form, so a floating badge pinned to a bottom corner
  // covers part of a real control at 375px: measured, it swallowed 2 of 9 probe
  // points across the front door's first "Buy tickets", and moving it to
  // bottom-right just handed the same dead corner to the last card in the rail.
  // It cost a reviewer a "the CTA does nothing" bug report that was never in the
  // app at all. Never rendered in a production build either way.
  //
  // To get it back for a session: delete this line, or run
  // `NEXT_DEV_INDICATOR=1 npm run dev` after making it env-driven.
  devIndicators: false,
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // /events was the public event listing until the front door absorbed it. The
  // path is in the wild — printed on flyers, pasted into WhatsApp, indexed — so
  // it redirects rather than 404s. Permanent: the route is not coming back.
  async redirects() {
    return [{ source: "/events", destination: "/", permanent: true }];
  },
  // Phone-first PWA-ish defaults; image optimization stays on for badge/QR assets.
  experimental: {
    // Server Actions are enabled by default in Next 15; nothing extra needed.
  },
};

export default nextConfig;
