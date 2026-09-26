/**
 * Staff-screen audit — role gating and the phone-first rules, on the deployed env.
 *
 *   npx tsx scripts/audit-staff-screens.ts
 *   npx tsx scripts/audit-staff-screens.ts --base=http://localhost:3000
 *
 * Signs in as EVERY test role in turn (via /api/test-login, which is what the
 * /test-login screen posts to) and walks every staff route, recording two things
 * per cell:
 *
 *   ACCESS  — did this role reach the screen, or get bounced to /login /  denied?
 *   MOBILE  — at 390x844: sideways scroll, and tap targets under 48px.
 *
 * WHY every role and not just coordinator: coordinator is a superuser, so a
 * screen that renders for it proves nothing about whether a station volunteer is
 * fenced out of the dashboard or a no-till volunteer is fenced out of cash. The
 * interesting cells are the DENIALS, and only a restricted role can produce one.
 *
 * WHY tap targets are measured through the real ancestor: a 20px radio inside a
 * 48px <label> is a 48px target. Walking to the outermost single-input pointer
 * wrapper avoids reporting a wall of false positives — CSS `cursor` inherits, so
 * a naive ancestor check stops at the first inner span and lies.
 *
 * Read-only. Navigates and measures; never submits a form.
 */
import { chromium, type Browser, type Page } from "playwright";

const arg = (n: string, d?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const BASE = arg("base", "https://test.dcica.org")!;
const PASSWORD = process.env.TEST_LOGIN_PASSWORD ?? "camp-test";

/** Username -> the row it occupies in the access table in CLAUDE.md. */
const ROLES = [
  "coordinator",
  "regdesk",
  "regdesk-notill",
  "volunteer",
  "doctor",
  "pos",
  "admin",
  "volcoord",
];

/**
 * Real routes only, taken from `find src/app -name page.tsx`. Guessing route
 * names is how the first run of this file reported `/admin/camp` as reachable by
 * all eight roles: the route does not exist, its 404 renders at the requested
 * URL, and a path-equality check called that "reached". The lesson is baked into
 * `classify()` below — a 404 is now its own verdict, never an access result.
 */
const SCREENS = [
  "/dashboard",
  "/admin",
  "/admin/camps",
  "/admin/members",
  "/admin/membership",
  "/admin/settings",
  "/admin/email",
  // The merged scan station. /gate and /checkin are redirects TO it and are
  // deliberately NOT audited: they carry no guard of their own (that would be
  // two places deciding who may open a door), so the thing worth auditing is
  // /scan. classify() treats "final path != requested path" as a denial, so
  // listing them here would report FORBIDDEN for all eight roles.
  "/scan",
  "/station",
  "/station/checkin",
  "/volunteers",
  "/volunteers/counselors",
  "/volunteer/checkin",
];

type Cell = {
  role: string;
  screen: string;
  status: number | null;
  finalPath: string;
  access: "OK" | "REDIRECTED" | "FORBIDDEN" | "NOT_FOUND" | "ERROR";
  heading: string;
  overflowsX: boolean;
  smallTargets: { tx: string; w: number; h: number }[];
  mentionsCash: boolean;
  consoleErrors: number;
};

async function audit(page: Page, role: string, screen: string): Promise<Cell> {
  const errs: string[] = [];
  const onErr = (m: { type(): string; text(): string }) => { if (m.type() === "error") errs.push(m.text()); };
  page.on("console", onErr as never);
  const cell: Cell = {
    role, screen, status: null, finalPath: "", access: "ERROR", heading: "",
    overflowsX: false, smallTargets: [], mentionsCash: false, consoleErrors: 0,
  };
  try {
    const resp = await page.goto(`${BASE}${screen}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    cell.status = resp?.status() ?? null;
    const url = new URL(page.url());
    cell.finalPath = url.pathname;
    // Status FIRST, path second. A missing route renders its 404 at the very URL
    // that was requested, so a path-equality check alone reports "reached" for a
    // page that does not exist — which is exactly how this audit first claimed
    // every role could open a nonexistent admin screen.
    cell.access =
      cell.status === 404 ? "NOT_FOUND"
      : /login|signin/.test(url.pathname) ? "REDIRECTED"
      : url.pathname === "/403" || cell.status === 403 ? "FORBIDDEN"
      : url.pathname === screen && (cell.status ?? 500) < 400 ? "OK"
      : "FORBIDDEN";

    const probe = await page.evaluate(() => {
      const de = document.documentElement;
      const small: { tx: string; w: number; h: number }[] = [];
      for (const el of Array.from(document.querySelectorAll("a,button,input,select,textarea,[role=button]"))) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (getComputedStyle(el).display === "none") continue;
        // Walk OUT to the real target: the outermost ancestor that still wraps
        // exactly this one control and is itself clickable.
        let best: Element = el, node: Element = el;
        const tag = el.tagName;
        const isBox = tag === "INPUT" && ["radio", "checkbox"].includes((el as HTMLInputElement).type);
        if (isBox) {
          while (node.parentElement) {
            node = node.parentElement;
            if (node.tagName === "BODY") break;
            const n = node.querySelectorAll("input[type=radio],input[type=checkbox]").length;
            if (n === 1 && (node.tagName === "LABEL" || getComputedStyle(node).cursor === "pointer")) best = node;
            if (n > 1) break;
          }
        }
        const br = best.getBoundingClientRect();
        if (br.height < 48 || br.width < 48) {
          small.push({
            tx: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).type || "").trim().slice(0, 28),
            w: Math.round(br.width), h: Math.round(br.height),
          });
        }
      }
      const h = document.querySelector("h1,h2");
      return {
        overflowsX: de.scrollWidth > de.clientWidth + 1,
        small,
        heading: (h as HTMLElement | null)?.innerText?.trim().slice(0, 44) ?? "",
        // Till gating is a money control: a role that cannot hold a till must not
        // be offered a cash tender option anywhere on the screen.
        cash: /\bcash\b/i.test(document.body.innerText),
      };
    });
    cell.overflowsX = probe.overflowsX;
    cell.smallTargets = probe.small;
    cell.heading = probe.heading;
    cell.mentionsCash = probe.cash;
  } catch (err) {
    cell.heading = err instanceof Error ? err.message.split("\n")[0].slice(0, 60) : String(err);
  } finally {
    cell.consoleErrors = errs.length;
    page.off("console", onErr as never);
  }
  return cell;
}

async function main(): Promise<void> {
  console.log(`base=${BASE}\nroles=${ROLES.length} screens=${SCREENS.length}\n`);
  const browser: Browser = await chromium.launch({ headless: true });
  const all: Cell[] = [];

  for (const role of ROLES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      isMobile: true, hasTouch: true,
    });
    // context.request shares the cookie jar with the pages, so the session this
    // mints is the session the navigations below run under.
    const login = await ctx.request.post(`${BASE}/api/test-login`, {
      data: { username: role, password: PASSWORD },
    });
    if (!login.ok()) {
      console.log(`${role.padEnd(15)} LOGIN FAILED ${login.status()} ${(await login.text()).slice(0, 80)}`);
      await ctx.close();
      continue;
    }
    const page = await ctx.newPage();
    const cells: Cell[] = [];
    for (const s of SCREENS) cells.push(await audit(page, role, s));
    all.push(...cells);

    const ok = cells.filter((c) => c.access === "OK").map((c) => c.screen);
    const denied = cells.filter((c) => c.access !== "OK");
    console.log(`${role.padEnd(15)} reached ${String(ok.length).padStart(2)}/${SCREENS.length}`);
    if (denied.length) {
      console.log(`  denied: ${denied.map((d) => `${d.screen}->${d.finalPath}`).join("  ")}`);
    }
    await ctx.close();
  }
  await browser.close();

  console.log("\n=== ACCESS MATRIX (. = reached, X = bounced) ===");
  const w = Math.max(...SCREENS.map((s) => s.length));
  console.log("screen".padEnd(w) + "  " + ROLES.map((r) => r.slice(0, 6).padEnd(7)).join(""));
  for (const s of SCREENS) {
    const row = ROLES.map((r) => {
      const c = all.find((x) => x.role === r && x.screen === s);
      return (c?.access === "OK" ? "." : c?.access === "NOT_FOUND" ? "404" : c ? "X" : "?").padEnd(7);
    }).join("");
    console.log(s.padEnd(w) + "  " + row);
  }

  console.log("\n=== MOBILE VIOLATIONS on reached screens ===");
  const reached = all.filter((c) => c.access === "OK");
  const byScreen = new Map<string, Cell>();
  for (const c of reached) if (!byScreen.has(c.screen)) byScreen.set(c.screen, c);
  for (const [screen, c] of byScreen) {
    const uniq = new Map<string, { tx: string; w: number; h: number }>();
    for (const t of c.smallTargets) uniq.set(`${t.tx}|${t.w}x${t.h}`, t);
    const list = [...uniq.values()];
    console.log(
      `${screen.padEnd(w)}  overflowX=${c.overflowsX ? "YES" : "no "}  sub48=${String(list.length).padStart(2)}` +
        (list.length ? `  ${list.slice(0, 6).map((t) => `"${t.tx}" ${t.w}x${t.h}`).join("; ")}` : ""),
    );
  }

  console.log("\n=== CASH VISIBILITY (till gating) ===");
  for (const r of ROLES) {
    const hits = reached.filter((c) => c.role === r && c.mentionsCash).map((c) => c.screen);
    console.log(`  ${r.padEnd(15)} ${hits.length ? hits.join(", ") : "(no screen mentions cash)"}`);
  }

  const errs = all.filter((c) => c.consoleErrors > 0);
  console.log(`\nconsole errors: ${errs.length ? errs.map((e) => `${e.role}${e.screen}(${e.consoleErrors})`).join(" ") : "none"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
