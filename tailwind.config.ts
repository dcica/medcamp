import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Phone-first: 48px minimum tap target is a platform constraint.
      minHeight: {
        tap: "48px",
      },
      minWidth: {
        tap: "48px",
      },
      colors: {
        // Per-tenant branding overrides these at runtime via CSS vars.
        brand: {
          DEFAULT: "var(--brand, #0d6e6e)",
          fg: "var(--brand-fg, #ffffff)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
