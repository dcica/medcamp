import { db } from "@/lib/db";
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
      <h1 className="text-2xl font-bold text-brand">{event.name}</h1>
      <p className="mt-1 text-sm text-gray-600">
        Register below. You&apos;ll get a QR badge by email after payment.
      </p>
      <RegisterForm eventId={event.id} services={services} />
    </main>
  );
}
