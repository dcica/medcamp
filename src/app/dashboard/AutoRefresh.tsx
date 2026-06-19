"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling refresh for the dashboard until Supabase Realtime is wired (its anon
 * channel needs RLS policies, deferred under Approach C). Shows a subtle live dot.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);

  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className="flex items-center gap-1.5 text-xs text-gray-500"
      title="Toggle auto-refresh"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${on ? "bg-green-500" : "bg-gray-300"}`}
      />
      {on ? "Live" : "Paused"}
    </button>
  );
}
