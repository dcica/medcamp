"use server";

import { ZodError } from "zod";
import {
  createVolunteerSignup,
  cancelSignup,
  registerGeneralVolunteer,
  type VolunteerSignupInput,
  type GeneralVolunteerInput,
} from "@/server/volunteers";

/**
 * A refused signup has to read as copy, not as a stack. createVolunteerSignup
 * calls volunteerSignupSchema.parse(), so a validation failure arrives as a
 * ZodError whose `.message` is a JSON dump of the issue list — which is exactly
 * what the red box on the form rendered before this existed. Every message in
 * that schema is written by us for the volunteer to read, so they are surfaced
 * verbatim (no trailing punctuation added: they already end in a full stop).
 *
 * This matters most for the counselor pair: a half-filled pair is now a refusal
 * rather than a silent drop, so the refusal is the ONLY thing telling the
 * volunteer we could not keep their answer. It cannot be a JSON blob.
 */
function toVolunteerMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const messages = [...new Set(err.issues.map((i) => i.message))];
    if (messages.length === 0) return "Please check your details and try again.";
    return messages.join(" ");
  }
  if (err instanceof Error && err.message) return err.message;
  return "Signup failed.";
}

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
    return { ok: false, error: toVolunteerMessage(err) };
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
