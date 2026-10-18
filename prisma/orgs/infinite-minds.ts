import type { OrgSeed } from "./types";

/**
 * Infinite Minds — a tuition-free public charter school in Arlington, TX, and
 * the first tenant that is not dcica. Fundraisers: pickleball tournaments,
 * dinners, other ticketed events, plus general donations.
 *
 * The palette is a placeholder that passes the contrast validator; the
 * school's own colours and logo replace it in /admin/settings once they are
 * supplied (go-live checklist item 6). The catalogue is the shape of their
 * first events — prices live on each event's caps, not here.
 */
export const infiniteMinds: OrgSeed = {
  slug: "infinite-minds",
  name: "Infinite Minds",
  settings: {
    theme: {
      brand: "#1d3557", // deep navy
      brandFg: "#ffffff",
      accent: "#f4a261", // warm orange; dark text at 8:1
      accentFg: "#16201f",
      accent2: "#1b6f65", // teal; white text at 6:1
      accent2Fg: "#ffffff",
      wordmark: "Infinite",
    },
    locale: "en",
    seo: {
      legalName: "Infinite Minds",
      sameAs: ["https://www.infinitemindstx.org"],
      locality: "Arlington",
      region: "TX",
      // nonprofitStatus deliberately unset: whether the school is a 501(c)(3)
      // corporation or a governmental unit is theirs to assert.
    },
  },
  services: [
    { key: "pickleball-singles", name: "Pickleball — Singles Entry", priceCents: 0, kind: "ADMISSION", admitsCount: 1 },
    { key: "pickleball-doubles", name: "Pickleball — Doubles Entry", priceCents: 0, kind: "ADMISSION", admitsCount: 2 },
    { key: "dinner-seat", name: "Dinner — Seat", priceCents: 0, kind: "ADMISSION", admitsCount: 1 },
    { key: "dinner-table-8", name: "Dinner — Table of 8", priceCents: 0, kind: "ADMISSION", admitsCount: 8 },
  ],
  membershipPlans: [],
  // The first coordinator's email is a go-live checklist item (5); add it here
  // and the invite is accepted on their first sign-in.
  invites: [],
  domains: {
    production: ["events.infinitemindstx.org"],
    // No test host on purpose: their test surface is /o/infinite-minds on the
    // platform host, which needs no DNS and no certificate.
    test: [],
    development: [],
  },
};
