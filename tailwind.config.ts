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
        // dcica defaults mirror dcica.org (navy / saffron / flag-green).
        brand: {
          DEFAULT: "var(--brand, #0c3543)",
          fg: "var(--brand-fg, #ffffff)",
        },
        accent: {
          DEFAULT: "var(--accent, #f9a200)",
          fg: "var(--accent-fg, #16201f)",
        },
        accent2: {
          DEFAULT: "var(--accent-2, #138808)",
          fg: "var(--accent-2-fg, #ffffff)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
