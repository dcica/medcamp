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

  // ONE clock for the whole render: the candidate query, the predicate and the
  // displayed prices all answer to this instant. A single request must not hold
  // two opinions about whether an event is sellable — that split is the exact
  // class of bug isRegistrationOpen exists to prevent, so don't call new Date()
  // again further down.
  const now = new Date();

  // Fetch first, then apply isRegistrationOpen — the same predicate the submit
  // action uses. Filtering on status in the query is what let the two disagree:
  // this page would render a checkout the action then refused. The ?event=<id>
  // branch is therefore deliberately UNfiltered — a direct link must reach the
  // predicate and be judged by it.
  const candidate = eventId
    ? await db.event.findFirst({ where: { id: eventId } })
    : // Narrows the CANDIDATE POOL to exactly the states isRegistrationOpen
      // accepts. It restates the predicate's rule, and that duplication is safe
      // in one direction only: this query merely SELECTS a candidate, and
      // isRegistrationOpen below is still the sole decider, applied to whatever
      // comes back. So drift between the two can only ever produce a false empty
      // state — "no camp is open" while one is — never a checkout the submit
      // action then refuses. The harmful direction is unreachable by
      // construction; that is why the mirror is allowed to exist.
      // It must mirror the predicate rather than filter status: "OPEN" alone: on
      // camp night the event is ACTIVE with walkInOpensAt set — a state the
      // predicate accepts — and a status-only pool answered "no camp is open" to
      // the walk-in who had just been told to register on their phone. Dropping
      // the pool filter entirely fails the other way: finished events were in the
      // pool and the earliest one won, so the page refused while an open event
      // was on sale. `endsAt` asc picks the soonest-ending — the next thing
      // happening.
      await db.event.findFirst({
        where: {
          OR: [
            { status: "OPEN", endsAt: { gte: now } },
            { status: "ACTIVE", walkInOpensAt: { not: null } },
          ],
        },
        orderBy: { endsAt: "asc" },
      });
  const event = candidate && isRegistrationOpen(candidate, now) ? candidate : null;

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
  // charged another. Priced against the same `now` the gating above used.
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

  // Does any offering on THIS event mail labs? Derived from the offerings
  // already fetched above (serviceType is included), so no extra round trip.
  const hasLab = offerings.some((o) => o.serviceType.hasLab);

  // The help copy is built from the event's own flags, NOT hardcoded. It used to
  // be a constant written for the medical camp, and that is exactly how a
  // conditional promise of money back ("except if the camp is rescheduled")
  // ended up on a no-refunds dandiya event — while the very same flags were
  // being passed to <RegisterForm> a few lines below, which rendered the correct
  // policy. Help copy that describes a UI the buyer is not looking at is a
  // defect, and on the refund item it is a defect about money. If you are
  // tempted to flatten this back into a constant: don't.
  const helpItems = [
    {
      label: "Your contact details",
      body: "The registrant receives the confirmation and QR badges. You don't have to be attending yourself.",
    },
    event.collectsAttendeeDetails
      ? {
          label: "Attendees",
          body: "Add one row per person attending. Use “+ Add another attendee” for family members; remove extras with Remove.",
        }
      : {
          label: "Quantity",
          body: "Pick how many of each item you want — no names or per-person details are collected. Every admission gets its own scannable code, emailed to the registrant.",
        },
    // Same flag as the item above, because the two modes render different
    // controls: tappable per-attendee rows vs. −/+ steppers. The old single
    // sentence described the attendee rows to everyone. It also claimed
    // "sold-out services are disabled", which is untrue in BOTH modes — nothing
    // in the form is ever disabled for capacity (caps are enforced atomically at
    // payment confirmation, see the comment above `offerings`). Do not put a
    // sold-out claim back unless the form actually grows one.
    event.collectsAttendeeDetails
      ? {
          label: "Services",
          body: "Tap a service to add it for that person, and tap again to remove it. The total updates live, and prices are confirmed on the server at payment.",
        }
      : {
          label: "Services",
          body: "Use − and + to change a count, or set it back to zero to drop the item. The total updates live, and prices are confirmed on the server at payment.",
        },
    // Only worth explaining when there is a lab service AND an address field to
    // explain — the field is rendered per attendee, so quantity mode never asks
    // for it.
    ...(hasLab && event.collectsAttendeeDetails
      ? [
          {
            label: "Mailing address",
            body: "Only used to post lab results back to the attendee. We check it as you go and may suggest a standardized version — accept it or keep your own. Leave blank if no labs are selected.",
          },
        ]
      : []),
    {
      label: "Refunds",
      // Deliberately points at the policy line the form already renders instead
      // of restating it. Two wordings of the refund policy on one page is how
      // the contradiction happened; there must not be a third.
      body: event.allowsRefunds
        ? "Refunds are handled by staff, not online — there is no self-serve refund in this form. The policy that applies is the one shown next to the pay button."
        : "All sales are final — no refunds, including no-shows. Please check your selections before you pay.",
    },
  ];

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="register"
        title={event.name}
        subtitle="Register below. You'll get a QR badge by email after payment."
        items={helpItems}
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
