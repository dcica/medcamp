import { redirect } from "next/navigation";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

// Dynamic, like every other page here. Not because the redirect needs it —
// it touches nothing — but because the ROOT LAYOUT reads tenant branding
// from the database to emit the theme, so any statically prerendered route
// tries to reach Postgres at build time. Dropping this broke `next build`
// in a container, where there is no database to reach.
export const dynamic = "force-dynamic";

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
