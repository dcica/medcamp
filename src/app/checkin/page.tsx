import { redirect } from "next/navigation";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

// Dynamic, like every other page here. Not because the redirect needs it —
// it touches nothing — but because the ROOT LAYOUT reads tenant branding
// from the database to emit the theme, so any statically prerendered route
// tries to reach Postgres at build time. Dropping this broke `next build`
// in a container, where there is no database to reach.
export const dynamic = "force-dynamic";

/**
 * /checkin is now /scan, which serves a camp desk and a dandiya door from one
 * screen. The per-attendee page /checkin/[campId] is UNCHANGED and is still
 * where a scan lands — it keeps its own narrower CHECKIN_ROLES guard.
 *
 * Kept as a redirect for the same reason as /gate: it is in run sheets and in
 * volunteers' history.
 */
export const metadata = PRIVATE_PAGE_METADATA;

export default function CheckinRedirect() {
  redirect("/scan");
}
