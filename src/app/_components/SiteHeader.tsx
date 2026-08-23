import Image from "next/image";
import Link from "next/link";
import { getCurrentMember } from "@/server/session";
import { getActiveBranding } from "@/lib/tenant";
import { StaffMenu } from "./StaffMenu";

/**
 * Global top bar. Gives every screen a home anchor. For signed-in members it
 * shows the staff Menu (the operational module index — registration, check-in,
 * stations, dashboard, admin — that used to sit on the home page); for everyone
 * else it shows a sign-in link. Hidden on print so badge labels render clean
 * (see .no-print).
 *
 * The wordmark is the short brand mark (dcica's is "DCICA") so it doesn't
 * duplicate the home page's org-name h1. Both the mark and the wordmark come
 * from the active tenant now — a second organization changes them in settings
 * rather than by editing this file. `getActiveBranding` is request-cached, so
 * reading it here costs no extra query on top of the root layout's.
 */
export async function SiteHeader() {
  const [member, branding] = await Promise.all([
    getCurrentMember(),
    getActiveBranding(),
  ]);

  return (
    // Saffron bar mirrors dcica.org's nav; navy wordmark matches the DCICA logo.
    <header className="no-print bg-accent text-accent-fg">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between gap-2 px-4">
        <Link
          href="/"
          // min-w-0 + truncate: a tenant's wordmark is tenant data, and the
          // phone-first rule is that nothing scrolls sideways at 375px.
          className="flex min-h-tap min-w-0 items-center gap-2 text-lg font-bold text-brand"
        >
          <Image
            src={branding.markUrl}
            alt=""
            width={28}
            height={28}
            className="shrink-0 rounded-full"
          />
          <span className="truncate">{branding.wordmark}</span>
        </Link>
        {/* The bar carries the home link (the logo, left) and one control. The
            "Events" link that sat here is now in the menu for staff; signed-out
            visitors reach the same list via the logo, since the home page IS
            the events listing. */}
        <nav className="flex shrink-0 items-center gap-4">
          {member ? (
            <StaffMenu
              name={member.name ?? member.email}
              role={member.role}
            />
          ) : (
            <Link
              href="/login"
              className="flex min-h-tap items-center text-sm font-medium text-brand"
            >
              Staff sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
