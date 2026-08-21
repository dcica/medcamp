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
 *
 * THE INVARIANT, which is load-bearing: no check here may reject anything
 * registrationSchema accepts. Each rule is therefore either strictly weaker
 * than its server counterpart (email) or character-for-character identical to
 * it (name, phone) — never tighter. A client validator stricter than the server
 * turns a buyer with a working address or number away at the last step, and on
 * the night of an event there is no recovery path. When a server bound moves,
 * move the matching rule here in the SAME commit.
 *
 * Drop-in for volunteer / vendor / org-onboarding fields with the same defect.
 */
/**
 * Default field styling. A BORDER is the load-bearing part: with `className`
 * left undefined the input rendered as bare native text with no box at all, so
 * an empty field looked like static page text and its placeholder read as a
 * value already filled in. Both were reported from the performance entry form,
 * which passed no className.
 *
 * Defaulting it here rather than making callers pass it means the next form
 * cannot reintroduce the same defect by omission.
 */
export const INPUT_CLASS =
  "w-full min-h-tap rounded-lg border border-gray-300 px-3 py-2 text-base";

export function ValidatedInput({
  value,
  onChange,
  validate,
  issue = null,
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
  /**
   * A message the PARENT knows and this field cannot: a CROSS-FIELD rule, where
   * whether this value is acceptable depends on another field. `validate` runs
   * on this field's own blur and deliberately stays quiet on an empty field
   * nobody has engaged with — correct for "required", wrong for "you filled in
   * the counselor's name, so now you owe me their email". Pass that case here
   * and it renders in the same place, with the same a11y wiring. Parent-owned:
   * pass null when there is nothing to say.
   */
  issue?: string | null;
  className?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  /**
   * Distinct from `type` — this only picks the mobile keyboard. The union was
   * originally a copy of `type`'s, which left "numeric" unavailable even though
   * it is the right keypad for a count field (and avoids type="number"'s
   * spinners and scroll-to-change behaviour).
   */
  inputMode?: "text" | "email" | "tel" | "numeric";
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

  // The parent's cross-field message wins: it knows something this field cannot
  // see, and it is the reason a name typed with the email left blank now says so
  // instead of failing silently on the server.
  const shown = issue ?? error;

  return (
    <div>
      <input
        className={className ?? INPUT_CLASS}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
      />

      {shown && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {shown}
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
 * Phone check, identical to the server rule (`z.string().trim().min(7)`) —
 * length of the TRIMMED value, and nothing else. No formatting, no masking, no
 * country-code inference, and deliberately NOT a digit count: "at least 7
 * digits" would reject strings the server accepts, and an international or
 * extension-bearing number the buyer types their own way must go through
 * untouched.
 *
 * The `.trim()` here mirrors the `.trim()` added to registrationSchema in the
 * same commit and must not drift from it. Before that, BOTH sides measured the
 * raw string, which is why this check was untrimmed. Trimming only the server
 * would have re-opened the divergence in the harmless-looking direction —
 * client accepts seven spaces, server refuses them — costing the buyer a round
 * trip and a page-level red box instead of inline feedback under the field.
 */
export function validatePhone(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return "Phone is required.";
  if (v.length < 7) return "That phone number looks too short.";
  return null;
}

/**
 * Name check, identical to the server rule (`z.string().trim().min(1)`): a
 * value that is empty once trimmed is not a name. Nothing else is checked —
 * no minimum word count, no letters-only rule, no length ceiling. Mononyms,
 * initials, non-Latin scripts and names with punctuation are all real, and
 * rejecting one costs a sale with no recovery path at the door.
 *
 * The name is what `formatCampId` prints on the badge, so "  " here becomes a
 * blank badge nobody can match to a person at check-in — which is why the
 * server started trimming and why this exists at all.
 */
export function validateName(value: string): string | null {
  if (value.trim().length === 0) return "Name is required.";
  return null;
}
