"use client";

import { useEffect } from "react";

/**
 * The route-level error boundary. There was none before this, anywhere in the
 * app — a render that threw showed the stock Next.js page and left no record
 * once the platform logs aged out two hours later.
 *
 * Two jobs, in order of importance to the person looking at it:
 *   1. tell a volunteer what to do next, in words, with a button;
 *   2. report itself, so the same failure is still readable in the morning.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // keepalive, because this often fires as the user is navigating away and
    // an ordinary fetch would be cancelled with the page.
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest }),
      keepalive: true,
    }).catch(() => {
      /* the reporter must never be the thing that breaks the error page */
    });
  }, [error]);

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-10">
      <h1 className="text-xl font-bold">That screen didn&rsquo;t load</h1>
      <p className="mt-2 text-sm text-gray-600">
        Nothing you just did was lost. Try again, and if it keeps happening tell
        a coordinator — this has been recorded.
      </p>
      {error.digest && (
        // The one thing worth reading aloud over a phone: it is what ties this
        // screen to the row in the error log.
        <p className="mt-2 font-mono text-xs text-gray-500">
          Reference {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-tap w-full rounded-lg bg-brand font-semibold text-brand-fg"
      >
        Try again
      </button>
    </main>
  );
}
