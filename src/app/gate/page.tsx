import { redirect } from "next/navigation";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

/**
 * /gate is now /scan.
 *
 * Kept as a redirect rather than deleted: the route is written on printed run
 * sheets, sits in volunteers' browser history, and is named throughout
 * docs/QA-Gate-Flow.md. A 404 at a door on event night is not an acceptable
 * cost for a tidier route table.
 *
 * The guard lives on /scan. This file deliberately does no auth work of its own
 * — two places deciding who may open the door is how they drift apart.
 */
export const metadata = PRIVATE_PAGE_METADATA;

export default function GateRedirect() {
  redirect("/scan");
}
