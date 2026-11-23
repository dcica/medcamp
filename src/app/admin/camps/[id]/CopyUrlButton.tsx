"use client";

import { useState } from "react";

/**
 * Copy a flyer link — for a WhatsApp message, an email or a bio link, where a
 * QR image is the wrong thing to send. The copied URL keeps its utm tags, so a
 * pasted link is still attributed to the door it names.
 */
export function CopyUrlButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex min-h-tap flex-1 items-center justify-center rounded-md border border-gray-300 text-sm font-medium"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy URL"}
    </button>
  );
}
