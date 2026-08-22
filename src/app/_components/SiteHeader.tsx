import Image from "next/image";
import Link from "next/link";
import { getCurrentMember } from "@/server/session";
import { StaffMenu } from "./StaffMenu";

/**
 * Global top bar. Gives every screen a home anchor. For signed-in members it
 * shows the staff Menu (the operational module index — registration, check-in,
 * stations, dashboard, admin — that used to sit on the home page); for everyone
 * else it shows a sign-in link. Hidden on print so badge labels render clean
 * (see .no-print).
 *
 * The wordmark is the short brand mark ("DCICA") so it doesn't duplicate the
 * home page's org-name h1.
 */
export async function SiteHeader() {
  const member = await getCurrentMember();

  return (
    // Saffron bar mirrors dcica.org's nav; navy wordmark matches the DCICA logo.
    <header className="no-print bg-accent text-accent-fg">
      <div className="mx-auto flex max-w-screen-sm items-center justify-between px-4">
        <Link
          href="/"
          className="flex min-h-tap items-center gap-2 text-lg font-bold text-brand"
        >
          <Image
            src="/icon.png"
            alt=""
            width={28}
            height={28}
            className="rounded-full"
          />
          DCICA
        </Link>
        {/* The bar carries the home link (the logo, left) and one control. The
            "Events" link that sat here is now in the menu for staff; signed-out
            visitors reach the same list via the logo, since the home page IS
            the events listing. */}
        <nav className="flex items-center gap-4">
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
