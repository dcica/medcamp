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
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // Phone-first PWA-ish defaults; image optimization stays on for badge/QR assets.
  experimental: {
    // Server Actions are enabled by default in Next 15; nothing extra needed.
  },
};

export default nextConfig;
