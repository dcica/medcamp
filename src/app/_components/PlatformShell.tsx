import Link from "next/link";

/**
 * The home page of the PLATFORM host, which owns no events: every
 * organisation's events live on its own site (or under /o/<slug> here). The
 * only thing a visitor can usefully do on this address is sign in as staff.
 */
export function PlatformShell() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-screen-sm flex-col justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-brand">Staff sign in</h1>
      <p className="mt-2 text-sm text-gray-600">
        Each organisation&apos;s events live on its own site. Staff sign in here
        and pick the organisation they work in.
      </p>
      <Link
        href="/login"
        className="mx-auto mt-6 inline-flex min-h-tap items-center justify-center rounded-md bg-brand px-5 text-sm font-semibold text-brand-fg"
      >
        Sign in
      </Link>
    </main>
  );
}
