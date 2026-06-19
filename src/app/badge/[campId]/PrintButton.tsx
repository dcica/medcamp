"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
    >
      Print badge
    </button>
  );
}
