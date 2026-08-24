import Link from "next/link";

// Static content, but the root layout above it reads the tenant palette from the
// database, so prerendering this at build time opens a Prisma connection during
// `next build`. That is the whole reason preview builds needed a DATABASE_URL.
// This page and not-found.tsx were the last two of 38 without the declaration.
export const dynamic = "force-dynamic";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-screen-sm flex-col justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-brand">Not authorized</h1>
      <p className="mt-2 text-sm text-gray-600">
        Your role doesn&apos;t have access to this area. Ask a coordinator if you
        think this is a mistake.
      </p>
      <Link href="/" className="mt-6 text-sm font-medium text-brand underline">
        Back to home
      </Link>
    </main>
  );
}
