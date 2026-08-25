import Link from "next/link";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

/**
 * Branded 404. Replaces Next's bare default ("404 — This page could not be
 * found") with chrome-wrapped content and a way home, so a lost visitor isn't
 * stranded. The root layout's header/footer wrap this automatically.
 */
/**
 * The one page in the app that is NOT force-dynamic by default, and therefore
 * the only one Next prerenders at build time. That made it the single reason a
 * build needed a live database: this component touches none, but the root layout
 * wrapping it calls getActiveBranding() to resolve the tenant palette, so
 * prerendering it opened a Prisma connection during `next build`.
 *
 * The consequence was not theoretical. Vercel Preview scope carries no
 * DATABASE_URL, so EVERY preview build on both projects failed with
 * "Environment variable not found: DATABASE_URL ... Error occurred prerendering
 * page /_not-found" while the identical commit built fine on the production ref.
 * Weeks of red builds on a page nothing serves, and it trained everyone to
 * ignore deploy failure mail — which is the expensive part.
 *
 * A build should not require a database. Opting this route out of prerendering
 * restores that, and costs nothing: the 404 renders per-request like the other
 * 37 pages, and its own content is static anyway.
 */
export const dynamic = "force-dynamic";

// Never a search result. See PRIVATE_PAGE_METADATA for which of the two
// reasons applies to this page.
export const metadata = PRIVATE_PAGE_METADATA;

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
