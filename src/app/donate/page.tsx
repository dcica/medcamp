import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getActiveOrg } from "@/lib/tenant";
import { resolveOrgDonations, resolveOrgProfile } from "@/lib/orgSettings";
import { activeFeePolicy, getResumableCheckout } from "@/server/payments";
import { readResumeCookie } from "@/server/resumeCookie";
import { PageHelp } from "@/app/_components/PageHelp";
import { DonateForm } from "./DonateForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Donate",
  description: "Make a gift online and receive a receipt by email.",
  alternates: { canonical: "/donate" },
};

/**
 * The organisation's donate page. 404 — not a "closed" notice — unless the
 * organisation has turned donations on: a door that is not open should not
 * exist, and every other entry point (footer, empty calendar, home rail)
 * reads the same flag so none of them can point here when it would 404.
 */
export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { cancelled } = await searchParams;
  const org = await getActiveOrg();
  if (!org) notFound();
  const donations = resolveOrgDonations(org.settings);
  if (!donations.enabled) notFound();
  const profile = resolveOrgProfile(org.settings);

  const resumable = cancelled
    ? await getResumableCheckout(org.id, cancelled, await readResumeCookie())
    : null;

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="donate"
        title={`Support ${org.name}`}
        subtitle="Every gift goes to the organisation directly."
        items={[
          {
            label: "Your receipt",
            body: profile.legalName
              ? `A receipt from ${profile.legalName} is emailed to you as soon as the payment clears. Keep it for your records.`
              : `A receipt from ${org.name} is emailed to you as soon as the payment clears. Keep it for your records.`,
          },
          {
            label: "Where the money goes",
            body: `Your gift settles in ${org.name}'s own account. If you tick the processing-cost box, that amount also goes to ${org.name}, not to this platform.`,
          },
          {
            label: "In honour of",
            body: "Name a person or an occasion and it is printed on your receipt and shown to the organisers.",
          },
        ]}
      />
      <DonateForm
        orgName={org.name}
        policy={donations}
        feePolicy={activeFeePolicy(org)}
        returnedFromCheckout={Boolean(cancelled)}
        resumable={resumable}
      />
    </main>
  );
}
