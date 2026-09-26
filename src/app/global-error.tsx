"use client";

import { useEffect } from "react";

/**
 * The last resort: a failure in the root layout itself, which the route-level
 * boundary cannot catch because it lives inside that layout.
 *
 * It must render its OWN <html> and <body> — there is no layout left to supply
 * them — and it deliberately uses inline styles rather than Tailwind classes,
 * because a stylesheet that failed to load is one of the ways to get here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `[root layout] ${error.message}`,
        digest: error.digest,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Something broke</h1>
        <p style={{ marginTop: "0.5rem", color: "#4b5563" }}>
          The page couldn&rsquo;t start. This has been recorded.
        </p>
        {error.digest && (
          <p style={{ marginTop: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#6b7280" }}>
            Reference {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem", minHeight: "48px", width: "100%",
            borderRadius: "0.5rem", border: "1px solid #d1d5db", fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
