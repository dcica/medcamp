import type { OrgSeed } from "./types";
import { dcica } from "./dcica";
import { infiniteMinds } from "./infinite-minds";

/**
 * Every tenant `db:seed` provisions, in order. An explicit list rather than a
 * directory scan: tsx has no glob convention here, and the order is the order
 * the modules are seeded in (dcica first, so a red later module leaves the
 * first tenant's rows committed and intact).
 */
export const ORG_SEEDS: readonly OrgSeed[] = [dcica, infiniteMinds];
