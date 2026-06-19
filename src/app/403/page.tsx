import Link from "next/link";

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
