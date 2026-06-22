import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/tenant";
import { PageHelp } from "@/app/_components/PageHelp";

export const dynamic = "force-dynamic";

/**
 * Public events landing (general events module). Lists the org's upcoming events
 * — anything OPEN or currently ACTIVE — in a dcica.org-style image card. The
 * action buttons per event are config-driven: a camp shows Register; a town
 * event we only attend shows Volunteer only; a community event shows vendor +
 * volunteer. See Event.offers* flags.
 */

const TYPE_LABEL: Record<string, string> = {
  CAMP: "Medical camp",
  GENERAL: "Event",
  MEMBERSHIP_DRIVE: "Membership",
};

// Primary registration wording by event type.
const REGISTER_LABEL: Record<string, string> = {
  CAMP: "Register",
  GENERAL: "Buy tickets",
  MEMBERSHIP_DRIVE: "Join or renew",
};

function formatWhen(start: Date, end: Date): string {
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
  const time = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${date.format(start)} · ${time.format(start)} – ${time.format(end)}`
    : `${date.format(start)} – ${date.format(end)}`;
}

export default async function EventsPage() {
  const org = await getActiveOrg();
  const events = org
    ? await db.event.findMany({
        where: { orgId: org.id, status: { in: ["OPEN", "ACTIVE"] } },
        orderBy: { startsAt: "asc" },
      })
    : [];

  return (
    <main className="mx-auto max-w-screen-md px-4 py-8">
      <PageHelp
        id="events"
        title="Upcoming events"
        subtitle="Register for a camp, buy tickets, or sign up as a vendor or volunteer."
        items={[
          {
            label: "Register / Buy tickets",
            body: "Opens the registration portal for that event. You'll get a QR badge by email after payment.",
          },
          {
            label: "Vendors",
            body: "Selling or sponsoring at an event? Tell us what you offer and we'll follow up with a booth.",
          },
          {
            label: "Volunteers",
            body: "Want to help run an event? Sign up and a coordinator will confirm your role and shift.",
          },
        ]}
      />

      {events.length === 0 ? (
        <p className="mt-8 rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
          No upcoming events right now. Check back soon.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {events.map((e) => {
            // Config-driven action set. First entry is the card's primary CTA.
            const actions: { key: string; label: string; href: string }[] = [];
            if (e.offersRegistration)
              actions.push({
                key: "register",
                label: REGISTER_LABEL[e.type] ?? "Register",
                href: `/register?event=${e.id}`,
              });
            if (e.offersVolunteers)
              actions.push({
                key: "volunteer",
                label: "Volunteer",
                href: `/volunteer?event=${e.id}`,
              });
            if (e.offersVendors)
              actions.push({
                key: "vendor",
                label: "Register as vendor",
                href: `/vendors?event=${e.id}`,
              });

            const [primary, ...secondary] = actions;

            return (
              <li
                key={e.id}
                className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
              >
                {e.imageUrl && (
                  <div className="relative aspect-[3/2] bg-gray-100">
                    <Image
                      src={e.imageUrl}
                      alt={e.name}
                      fill
                      sizes="(min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                )}

                {/* Saffron title/date panel — mirrors dcica.org's events design. */}
                <div className="bg-accent px-4 py-3 text-accent-fg">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
                      {e.externallyHosted ? "Community booth" : TYPE_LABEL[e.type] ?? "Event"}
                    </span>
                    {e.status === "ACTIVE" && (
                      <span className="rounded-full bg-accent2 px-2 py-0.5 text-xs font-semibold text-accent2-fg">
                        Happening now
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-lg font-bold leading-tight">
                    {e.name}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium">
                    {formatWhen(e.startsAt, e.endsAt)}
                  </p>
                  {e.location && (
                    <p className="mt-0.5 text-sm font-medium opacity-90">
                      {e.location}
                      {e.externallyHosted && e.hostedByName
                        ? ` · hosted by ${e.hostedByName}`
                        : ""}
                    </p>
                  )}
                </div>

                <div className="mt-auto space-y-2 p-4">
                  {e.description && (
                    <p className="text-sm text-gray-600">{e.description}</p>
                  )}
                  {primary && (
                    <Link
                      href={primary.href}
                      className="flex min-h-tap items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg"
                    >
                      {primary.label}
                    </Link>
                  )}
                  {secondary.length > 0 && (
                    <div
                      className={
                        secondary.length > 1
                          ? "grid grid-cols-2 gap-2"
                          : "grid grid-cols-1"
                      }
                    >
                      {secondary.map((a) => (
                        <Link
                          key={a.key}
                          href={a.href}
                          className="flex min-h-tap items-center justify-center rounded-lg border border-brand px-4 text-center text-sm font-medium text-brand"
                        >
                          {a.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
