import type { OrgSeed } from "./types";

/**
 * DCICA — the first tenant and the reference deployment. Moved here verbatim
 * from prisma/seed.ts when the seed became per-organisation; nothing about
 * the rows changed.
 */
export const dcica: OrgSeed = {
  slug: "dcica",
  name: "DCICA",
  // The palette the app actually renders (globals.css `:root`), under the
  // namespaced `theme` key the layout reads. Written in full because a theme
  // is validated as three colour PAIRS — a half-theme is refused, not merged.
  // Locale is unrelated config, kept.
  settings: {
    theme: {
      brand: "#0c3543", // deep navy — DCICA wordmark
      brandFg: "#ffffff",
      accent: "#f9a200", // saffron — dcica.org nav bar
      accentFg: "#16201f", // dark: saffron cannot carry white text at 4.5:1
      accent2: "#138808", // India-flag green — dcica.org footer band
      accent2Fg: "#ffffff",
      wordmark: "DCICA",
    },
    locale: "en",
  },
  // Service menu (the medical-camp catalogue; events price offerings per cap).
  services: [
    { key: "vision", name: "Vision Screening", priceCents: 1500, colorHex: "#2563eb", hasLab: false, kind: "ADMISSION" },
    { key: "dental", name: "Dental Check", priceCents: 2000, colorHex: "#16a34a", hasLab: false, kind: "ADMISSION" },
    { key: "bloodwork", name: "Bloodwork", priceCents: 3500, colorHex: "#dc2626", hasLab: true, kind: "ADMISSION" },
    { key: "general", name: "General Consult", priceCents: 0, colorHex: "#7c3aed", hasLab: false, kind: "ADMISSION" },
  ],
  // Family membership plans (catalogue). Tenant configuration, not fixtures:
  // these are the products the org sells, exactly like the service menu. The
  // odd prices are deliberate (51 / 101 / 251) — the card fee is passed to the
  // buyer. partySize 5 is what the comp admits free at an honoring event.
  membershipPlans: [
    { key: "family-1yr", name: "Family Membership — 1 Year", termYears: 1, priceCents: 5100, partySize: 5 },
    { key: "family-2yr", name: "Family Membership — 2 Year", termYears: 2, priceCents: 10100, partySize: 5 },
    { key: "family-5yr", name: "Family Membership — 5 Year", termYears: 5, priceCents: 25100, partySize: 5 },
  ],
  // dcica's first admins were granted through BOOTSTRAP_ADMIN_EMAILS before
  // invites existed; nothing to seed.
  invites: [],
  domains: {
    production: ["events.dcica.org"],
    test: ["test.dcica.org"],
    development: [],
  },
};
