import Link from "next/link";

/**
 * Branded 404. Replaces Next's bare default ("404 — This page could not be
 * found") with chrome-wrapped content and a way home, so a lost visitor isn't
 * stranded. The root layout's header/footer wrap this automatically.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-screen-sm flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-3 text-xl font-semibold text-gray-800">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-tap items-center rounded-lg bg-brand px-5 text-sm font-medium text-brand-fg"
      >
        Back to home
      </Link>
    </main>
  );
}
