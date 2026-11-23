import { notFound } from "next/navigation";
import { getActiveLegal, getActiveOrg, getActiveProfile } from "@/lib/tenant";
import { renderLegalBlocks } from "@/lib/legalText";
import { LegalBody } from "./LegalBody";

const TITLE = { privacy: "Privacy policy", terms: "Terms of service" } as const;

/**
 * /privacy and /terms: the organisation's own text, or an honest "not
 * published here yet" with its contact address. The platform never supplies
 * a policy on an organisation's behalf — a policy is a promise, and only the
 * organisation can make it.
 */
export async function LegalPage({ kind }: { kind: keyof typeof TITLE }) {
  const org = await getActiveOrg();
  if (!org) notFound();
  const [legal, profile] = await Promise.all([getActiveLegal(), getActiveProfile()]);
  const text = legal[kind];
  const title = TITLE[kind];

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <h1 className="text-2xl font-bold text-brand">{title}</h1>
      <p className="mt-1 text-xs text-gray-500">{org.name}</p>
      {text ? (
        <div className="mt-6">
          <LegalBody blocks={renderLegalBlocks(text)} />
        </div>
      ) : (
        <p className="mt-6 text-sm leading-relaxed text-gray-600">
          {org.name} has not published its {title.toLowerCase()} here yet.
          {profile.contactEmail ? (
            <>
              {" "}
              Write to{" "}
              <a href={`mailto:${profile.contactEmail}`} className="text-brand underline">
                {profile.contactEmail}
              </a>{" "}
              with any question about your data.
            </>
          ) : null}
        </p>
      )}
    </main>
  );
}
