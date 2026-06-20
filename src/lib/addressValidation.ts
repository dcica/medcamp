import { env } from "@/lib/env";

/**
 * Google Address Validation wrapper. Validates + standardizes a complete postal
 * address in ONE request (not per-keystroke autocomplete), so we share the
 * minimum PII with Google and only at the moment the user leaves the field.
 *
 * Server-only: GOOGLE_MAPS_API_KEY never reaches the browser. Reached through
 * the `checkAddress` server action, never imported by client code directly.
 *
 * Returns null when no key is configured or the call fails — registration then
 * proceeds with exactly what the user typed (graceful degradation; a self-hoster
 * without a Google key loses standardization but nothing breaks).
 *
 * Docs: https://developers.google.com/maps/documentation/address-validation
 */

const ENDPOINT =
  "https://addressvalidation.googleapis.com/v1:validateAddress";

export type AddressSuggestion = {
  /** Google's standardized single-line address, when it could produce one. */
  formatted: string | null;
  /** Google inferred, replaced, or flagged unconfirmed components. */
  changed: boolean;
  /** Address looks complete with no unconfirmed components. */
  confirmed: boolean;
};

export async function validateAddress(
  raw: string,
  regionCode = "US",
): Promise<AddressSuggestion | null> {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key || !raw.trim()) return null;

  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: { regionCode, addressLines: [raw] },
        // USPS CASS standardization for US/PR — these are mailed lab labels.
        enableUspsCass: regionCode === "US",
      }),
    });
    if (!res.ok) return null;

    const result = (await res.json())?.result;
    if (!result) return null;

    const verdict = result.verdict ?? {};
    return {
      formatted: result.address?.formattedAddress ?? null,
      changed: Boolean(
        verdict.hasInferredComponents ||
          verdict.hasReplacedComponents ||
          verdict.hasUnconfirmedComponents,
      ),
      confirmed:
        verdict.addressComplete === true &&
        !verdict.hasUnconfirmedComponents,
    };
  } catch {
    return null;
  }
}
