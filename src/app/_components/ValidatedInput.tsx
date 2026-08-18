"use client";

import { useId, useState } from "react";

/**
 * Controlled text field with explicit inline validation, modelled on
 * AddressInput: pass value/onChange like a bare <input>, feedback renders
 * directly below this field (never in the page-level error box), phone-first
 * (48px taps, single column).
 *
 * WHY this exists at all: the registration page has no <form> element and every
 * button is type="button", so native constraint validation never runs —
 * type="email" / type="tel" set the mobile keyboard and NOTHING else. No bubble,
 * no blocking, no :invalid styling hook. Do not delete this component on the
 * grounds that "the input type already validates it": it does not, and wrapping
 * the page in a <form> to make it do so would hand the buyer unstyleable native
 * bubbles at the top of the viewport, away from the field they are fixing.
 *
 * It never blocks. Validation state does not disable submit and never prevents
 * typing — the server schema (registrationSchema) remains the only authority.
 * The rules passed in here are deliberately WEAKER than the server's so a client
 * check can never reject an address or number the server would accept.
 *
 * Drop-in for volunteer / vendor / org-onboarding fields with the same defect.
 */
export function ValidatedInput({
  value,
  onChange,
  validate,
  className,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Returns a human message when invalid, or null when acceptable. */
  validate: (value: string) => string | null;
  className?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  "aria-label"?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // Whether the buyer has ever typed here. An empty field they merely tabbed
  // through is not an error yet — "required" on a field nobody has engaged with
  // is noise, and the server will still catch a genuinely missing value.
  const [dirty, setDirty] = useState(false);
  const reactId = useId();
  const errorId = `${reactId}-error`;

  function handleChange(next: string) {
    setDirty(true);
    onChange(next);
    // Only re-check while an error is already showing, so the message can
    // disappear the moment they fix it. We never raise a NEW error mid-typing:
    // telling someone their email is invalid on the second character is worse
    // than saying nothing.
    if (error) setError(validate(next));
  }

  function handleBlur() {
    if (!dirty && value === "") return;
    setError(validate(value));
  }

  return (
    <div>
      <input
        className={className}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
      />

      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Email shape check, deliberately permissive. The server rule is Zod's
 * `.email()`, whose regex requires a local part with no whitespace and no "@",
 * then "@", then at least one dot-separated label and a 2+ letter TLD. This
 * check asserts strictly less than that — one "@", something either side, and a
 * dot in the domain — so every address Zod accepts also passes here. It cannot
 * be the reason a buyer with a working address fails to reach checkout.
 *
 * No "clever" regex on purpose: rejecting an address the buyer actually owns
 * costs a sale and there is no recovery path on the night of the event.
 */
export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Email is required — your tickets are sent there.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return "That email doesn't look complete — check for a typo.";
  }
  return null;
}

/**
 * Phone check, identical to the server rule (`z.string().min(7)`) — length only.
 * No formatting, no masking, no country-code inference, and deliberately NOT a
 * digit count: "at least 7 digits" would reject strings the server accepts, and
 * an international or extension-bearing number the buyer types their own way
 * must go through untouched.
 */
export function validatePhone(value: string): string | null {
  if (value.length === 0) return "Phone is required.";
  if (value.length < 7) return "That phone number looks too short.";
  return null;
}
