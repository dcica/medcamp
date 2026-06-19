import Link from "next/link";

/**
 * Placeholder landing. The real app routes by tenant + role; this confirms the
 * scaffold renders and links to the modules as they come online.
 */
const MODULES = [
  { n: 1, name: "Registration Portal", href: "/register", ready: true },
  { n: 2, name: "Check-In & Badge", href: "#", ready: false },
  { n: 3, name: "Station Queue", href: "#", ready: false },
  { n: 4, name: "Coordinator Dashboard", href: "#", ready: false },
  { n: 5, name: "Supply Calculator", href: "#", ready: false },
  { n: 6, name: "Checklist Module", href: "#", ready: false },
  { n: 7, name: "Lab Tracking & Patient Portal", href: "#", ready: false },
  { n: 8, name: "Venue Config", href: "#", ready: false },
  { n: 9, name: "Volunteer Module", href: "#", ready: false },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-screen-sm px-4 py-10">
      <h1 className="text-2xl font-bold text-brand">dcica platform</h1>
      <p className="mt-2 text-sm text-gray-600">
        Non-profit event management &amp; commerce. Scaffold is live — modules
        come online below.
      </p>

      <ul className="mt-8 space-y-2">
        {MODULES.map((m) => (
          <li key={m.n}>
            <Link
              href={m.href}
              className="flex min-h-tap items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
            >
              <span>
                <span className="mr-2 text-gray-400">{m.n}.</span>
                {m.name}
              </span>
              <span
                className={
                  m.ready
                    ? "rounded-full bg-brand px-2 py-0.5 text-xs text-brand-fg"
                    : "text-xs text-gray-400"
                }
              >
                {m.ready ? "ready" : "soon"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
