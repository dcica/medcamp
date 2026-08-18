import { db } from "@/lib/db";
import { PageHelp } from "@/app/_components/PageHelp";
import { RegisterForm } from "./RegisterForm";
import { resolvePrice } from "@/lib/pricing";
import { isRegistrationOpen } from "@/server/registration";

export const dynamic = "force-dynamic";

/**
 * Public registration portal (Module 1). Loads the open camp + its service menu
 * server-side, then hands off to the phone-first form. Honours ?event=<id> from
 * the events listing for multi-event selection; with no id it falls back to the
 * next open event — the one ending soonest.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event: eventId } = await searchParams;

  // Fetch first, then apply isRegistrationOpen — the same predicate the submit
  // action uses. Filtering on status in the query is what let the two disagree:
  // this page would render a checkout the action then refused.
  const candidate = eventId
    ? await db.event.findFirst({ where: { id: eventId } })
    : // Narrows the CANDIDATE POOL to events that could plausibly sell —
      // isRegistrationOpen below is still the only thing that decides, and this
      // is not a second source of truth. Pre-filtering to a subset the predicate
      // already accepts cannot make the page more permissive than the action, so
      // it does not reopen the page/action disagreement above. Without it the
      // pool included finished events and the earliest one won, so this page
      // said "nothing is open" while an open event was on sale. `endsAt` asc
      // picks the soonest-ending open event — the next thing happening.
      await db.event.findFirst({
        where: { status: "OPEN", endsAt: { gte: new Date() } },
        orderBy: { endsAt: "asc" },
      });
  const event = candidate && isRegistrationOpen(candidate) ? candidate : null;

  if (!event) {
    return (
      <main className="mx-auto max-w-screen-sm px-4 py-10">
        <h1 className="text-xl font-bold">Registration</h1>
        <p className="mt-2 text-sm text-gray-600">
          No camp is open for registration right now.
        </p>
      </main>
    );
  }

  // Only services offered at THIS event (have a cap), priced per-event from the
  // cap. Capacity is enforced atomically at payment confirmation, not here.
  const offerings = await db.serviceCap.findMany({
    where: { eventId: event.id, serviceType: { active: true } },
    include: { serviceType: true },
    orderBy: { serviceType: { name: "asc" } },
  });
  // Display prices resolve through the SAME function registration.ts uses for
  // the authoritative total (src/lib/pricing.ts resolvePrice, "online"
  // channel) — this is a display feed, not a second source of truth. If this
  // diverged from registration.ts, the buyer would see one number and be
  // charged another.
  const now = new Date();
  const services = offerings.map((o) => ({
    key: o.serviceType.key,
    name: o.serviceType.name,
    priceCents: resolvePrice(o, "online", now).amountCents,
    colorHex: o.serviceType.colorHex,
    /** Non-fulfillable services are admission (scannable); merch is fulfillable. */
    fulfillable: o.serviceType.fulfillable,
  }));

  // Active family membership plans (shown as an add-on / compare on the form).
  const plans = await db.membershipPlan.findMany({
    where: { orgId: event.orgId, active: true },
    orderBy: { termYears: "asc" },
    select: { id: true, name: true, termYears: true, priceCents: true, partySize: true },
  });

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="register"
        title={event.name}
        subtitle="Register below. You'll get a QR badge by email after payment."
        items={[
          {
            label: "Your contact details",
            body: "The registrant receives the confirmation and QR badges. You don't have to be attending yourself.",
          },
          {
            label: "Attendees",
            body: "Add one row per person attending. Use “+ Add another attendee” for family members; remove extras with Remove.",
          },
          {
            label: "Services",
            body: "Tap to select. Sold-out services are disabled, and the total updates live. Prices are confirmed on the server at payment.",
          },
          {
            label: "Mailing address",
            body: "Only used to post lab results back to the attendee. We check it as you go and may suggest a standardized version — accept it or keep your own. Leave blank if no labs are selected.",
          },
          {
            label: "Refunds",
            body: "Registration fees are non-refundable, except if the camp is rescheduled — in that case a refund will be considered. Refunds are handled by staff, not online.",
          },
        ]}
      />
      <RegisterForm
        eventId={event.id}
        services={services}
        collectsAttendeeDetails={event.collectsAttendeeDetails}
        acceptsDonations={event.acceptsDonations}
        honorsMembership={event.honorsMembership}
        allowsRefunds={event.allowsRefunds}
        plans={plans}
      />
    </main>
  );
}
