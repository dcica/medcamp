"use server";

import { validateAddress } from "@/lib/addressValidation";

/**
 * Server action behind <AddressInput>. Keeps the Google key server-side: the
 * client sends the typed address, gets back a standardized suggestion (or null).
 */
export async function checkAddress(raw: string, regionCode = "US") {
  return validateAddress(raw, regionCode);
}
