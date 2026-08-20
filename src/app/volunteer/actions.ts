"use server";

import {
  createVolunteerSignup,
  cancelSignup,
  registerGeneralVolunteer,
  type VolunteerSignupInput,
  type GeneralVolunteerInput,
} from "@/server/volunteers";

export type SignupResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

/**
 * Public volunteer signup entry point. No login required. Creates (or revives a
 * cancelled) signup, dedupes the volunteer + counselor, assigns a QR code, then
 * routes to the confirmation page.
 */
export async function submitVolunteerSignup(
  input: VolunteerSignupInput,
): Promise<SignupResult> {
  try {
    const res = await createVolunteerSignup(input);
    return { ok: true, redirectUrl: `/volunteer/confirm/${res.signupId}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Signup failed.",
    };
  }
}

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelVolunteerSignup(
  signupId: string,
): Promise<CancelResult> {
  try {
    await cancelSignup(signupId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Cancel failed.",
    };
  }
}

export type GeneralInterestResult =
  | { ok: true; alreadyKnown: boolean }
  | { ok: false; error: string };

/**
 * Register general volunteer interest — no event, no login, no QR code, because
 * there is no shift to check into yet. Returns whether we already had this
 * person so the page can say "we've updated your details" rather than implying
 * a second record was created.
 */
export async function submitGeneralInterest(
  input: GeneralVolunteerInput,
): Promise<GeneralInterestResult> {
  try {
    const res = await registerGeneralVolunteer(input);
    return { ok: true, alreadyKnown: res.alreadyKnown };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not register interest.",
    };
  }
}
