/**
 * The org's one public contact address.
 *
 * Three surfaces reach for it — the site footer's Contact link, the empty
 * calendar state's two mailto CTAs, and the vendor interest page — and it was a
 * separate string literal in each. That is this codebase's characteristic bug:
 * the org changes address, two surfaces follow and one keeps the old one. One
 * constant, three importers.
 *
 * WHY a constant and not per-tenant config: it should eventually come from
 * `Organization.settings`, per the configuration-over-code mandate — a second
 * tenant self-hosting this platform must not have to edit source to change its
 * own contact address. That is a separate task; a settings read here today would
 * be a half-built one. Deduplicating the literal is the fix that fits now.
 *
 * The pre-launch swap is done: this was a personal address (sachin@buzzclan.com)
 * reached from every page footer and the empty calendar's primary CTA. It is now
 * the committee alias, so a visitor writes to the org rather than to a person.
 */
export const CONTACT_EMAIL = "events@dcica.org";
