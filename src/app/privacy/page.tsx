import type { Metadata } from "next";
import { LegalPage } from "@/app/_components/LegalPage";

// The root layout reads the organisation from the request; nothing here can
// be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How this organisation collects, uses and keeps the data you give it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
