import type { Metadata } from "next";
import { LegalPage } from "@/app/_components/LegalPage";

// The root layout reads the organisation from the request; nothing here can
// be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms under which this organisation sells tickets and takes registrations.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
