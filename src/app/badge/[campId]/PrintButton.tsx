"use client";

export function PrintButton({ label = "Print badge" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
    >
      {label}
    </button>
  );
}
