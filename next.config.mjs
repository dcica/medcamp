import { config } from "dotenv";

// Force this project's .env to win over any inherited shell variables (e.g. a
// machine-global DATABASE_URL belonging to another project). dotenv normally
// won't override an already-set var, so we pass override:true. next.config runs
// before the server modules evaluate, so the corrected values reach Prisma.
config({ override: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phone-first PWA-ish defaults; image optimization stays on for badge/QR assets.
  experimental: {
    // Server Actions are enabled by default in Next 15; nothing extra needed.
  },
};

export default nextConfig;
