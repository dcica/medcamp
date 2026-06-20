# Fix Plan / Work Log

Running log of implementation work and the deferred items behind it. Newest first.

---

## 2026-06-19 — Inline help, address validation, test harness, Google OAuth

### Shipped
- **Inline page help** — `src/app/_components/PageHelp.tsx`: a "?" toggle in the
  header that reveals contextual tips per page, hidden by default, remembered per
  page in `localStorage`. Wired into all 16 live routes (register, confirm,
  checkin, badge, station, dashboard, admin/*). Phone-first (48px tap target,
  no horizontal overflow verified at 360px).
- **Google address validation** — `src/lib/addressValidation.ts` (server-only
  wrapper), `src/app/_components/AddressInput.tsx` (suggest-&-confirm UX, never
  blocks), `address-action.ts` (server action keeps the key off the client).
  Wired into the registrant `mailingAddress` field. One call on blur, not
  per-keystroke. Free under 5,000/mo (~500/camp). `GOOGLE_MAPS_API_KEY` optional;
  unset ⇒ plain input. Disclosed in Privacy Policy + CLAUDE.md.
- **Config-gated test login** — `/test-login` (uid/password, off unless
  `TEST_LOGIN_ENABLED=true`), `src/lib/testAccounts.ts` (8 accounts, one per
  role), `src/app/api/test-login/route.ts`. Shared password via
  `TEST_LOGIN_PASSWORD`. Verified: coordinator→dashboard, doctor→/station &
  blocked from dashboard (/403), bad password→401.
- **Test data seed** — `prisma/seed-test.ts` (`npm run db:seed:test`),
  idempotent. ACTIVE camp `MC-2027S` + 22 attendees across all flow states
  (consult bottleneck, in-progress, completed, needs-payment, not-arrived),
  STRIPE+CASH payments, lab statuses, 8 role members, 5 volunteer roles + 14
  signups (15 computed volunteer hours). Demotes other ACTIVE camps so the test
  camp is unambiguously the active one.
- **Google OAuth** — configured + verified end-to-end (user signs in as
  `thejain@gmail.com` / `dentoncica@gmail.com` → COORDINATOR via
  `BOOTSTRAP_ADMIN_EMAILS`). Env wired; client secret JSON removed from repo and
  gitignored.

### Deferred / follow-ups
- [ ] **`getActiveCamp` assumes a single ACTIVE camp** (`findFirst({status:ACTIVE})`,
      no ordering). Nondeterministic with >1 active. The test seed works around it
      by demoting others; add a real guard (e.g. unique active-per-org or explicit
      "current camp" pointer) before multiple concurrent camps are possible.
- [ ] **Favicon 404** — no `favicon.ico` served (cosmetic).
- [ ] **Volunteer module (Module 9)** — no live screen yet; seed data is ready for
      when it ships.
- [ ] **D003** (backlog) — no-show: retain payment as a donation; pairs with the
      refund policy now in the register help.
- [ ] **D001 done**, **D002** (Vercel vs alternatives, free-tier) still parked.

### Before any production deploy
- [ ] Set `TEST_LOGIN_ENABLED=false` (the test login is a deliberate auth back door).
- [ ] Add the prod Google redirect URI `https://DOMAIN/api/auth/callback/google`;
      set `NEXTAUTH_URL` + `NEXT_PUBLIC_APP_URL` to the prod URL; publish the OAuth
      consent screen (or keep test users).
- [ ] Apply Stripe 501(c)(3) non-profit rate; swap test keys for live in Vercel env.
- [ ] Confirm `NEXTAUTH_SECRET` is set in the deploy environment.
