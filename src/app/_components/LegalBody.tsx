// Explicit, although Next's automatic runtime needs no import: verify-tenant
// §13 renders this component to static markup under tsx, whose classic JSX
// transform wants `React` in scope. Harmless in the app.
import * as React from "react";
import type { LegalBlock } from "@/lib/legalText";

const HEADING_CLASS = {
  1: "mt-8 text-xl font-bold text-brand first:mt-0",
  2: "mt-6 text-base font-semibold text-gray-900",
  3: "mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500",
} as const;

/**
 * Renders the blocks `renderLegalBlocks` produced. Plain React elements with
 * text children only — the escaping that keeps a typed `<script>` as text is
 * React's, and verify-tenant §13 renders this to static markup to prove it.
 */
export function LegalBody({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-700">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const Tag = `h${b.level}` as "h1" | "h2" | "h3";
          return (
            <Tag key={i} className={HEADING_CLASS[b.level]}>
              {b.text}
            </Tag>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
