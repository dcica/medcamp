import { redirect } from "next/navigation";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo";

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
