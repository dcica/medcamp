import { db } from "@/lib/db";
import { PageHelp } from "@/app/_components/PageHelp";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

/**
 * Public registration portal (Module 1). Loads the open camp + its service menu
 * server-side, then hands off to the phone-first form. For v1 we register into
 * the first OPEN event; multi-event selection is a later enhancement.
 */
export default async function RegisterPage() {
  const event = await db.event.findFirst({
    where: { status: "OPEN" },
    orderBy: { startsAt: "asc" },
  });

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

  const services = await db.serviceType.findMany({
    where: { orgId: event.orgId, active: true },
    orderBy: { name: "asc" },
    select: { key: true, name: true, priceCents: true, colorHex: true },
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
      <RegisterForm eventId={event.id} services={services} />
    </main>
  );
}
