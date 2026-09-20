/**
 * Google Analytics tag-hygiene check — where the tag is allowed to initialise,
 * and what it is allowed to say about a URL.
 *
 *   npx tsx scripts/verify-analytics.ts
 *
 * Sibling of verify-branding.ts, and pure for the same reason: no database, no
 * network. The thing under test is the INLINE SNIPPET in
 * src/app/_components/Analytics.tsx, which is read off disk as text and then
 * EXECUTED in a `node:vm` context with a fake `window.location` and a fake
 * `document`. Running the shipped snippet rather than a reimplementation of it
 * is the whole design of this suite: a second copy of the route guard or the
 * URL scrubber, living here, would pass forever while the real one rotted.
 *
 * The snippet is where the logic lives because the component is a SERVER
 * component and must stay one — see the long note in Analytics.tsx. §7 is the
 * section that pins that.
 *
 * WHY THIS SUITE EARNS ITS PLACE, section by section.
 *
 * §1  The route guard is the fix for a metrics outage, not a preference. A
 *     400-patient camp puts ~40 volunteer phones on venue WiFi hammering queue
 *     and dashboard routes for six hours — more page views in a morning than
 *     the public site sees in a month, from a handful of devices on one IP.
 *     Every ratio with sessions in the denominator becomes fiction, and it
 *     fails silently: the numbers still render, they are just wrong. Asserted
 *     as behaviour — no command queue AND no loader element — because "the
 *     prefix is in a list" is not the same claim as "nothing is sent".
 *
 * §2  The public funnel is the other half of that claim and it cannot be
 *     assumed. Suppressing `/register` or `/confirm/*` by accident would delete
 *     the conversion data the tag exists for.
 *
 * §3  `/volunteer/checkin` is staff while `/volunteer` (signup) and
 *     `/volunteers` (public roster) are funnel. A bare `startsWith("/volunteer")`
 *     — the obvious implementation — silently stops tracking volunteer
 *     recruitment, the one funnel nobody would notice going quiet. Asserted
 *     from both sides.
 *
 * §4  Consent Mode ordering is load-bearing and unobservable. gtag DISCARDS a
 *     `consent default` that arrives after `config`; the tag keeps working, so
 *     the only symptom of getting it wrong is a compliance posture that exists
 *     in the source and not in the browser. Asserted on the real command queue,
 *     by index.
 *
 * §5  THE MOST VALUABLE SECTION. `/confirm/[orderId]?session_id=cs_live_…` is
 *     where Stripe returns a paying customer, so without scrubbing every single
 *     purchase writes a live Checkout Session id into `page_location`, where it
 *     persists in GA reports and in any BigQuery export indefinitely.
 *
 * §6  The scrub must be a DENYLIST. Stripping the whole query string also
 *     passes every check in §5 while deleting `utm_*` — the campaign
 *     attribution this change exists to protect. Acquisition reports would keep
 *     rendering and every session would just become "direct". The utm
 *     assertions here are the ones that catch that, which is why §5 and §6 are
 *     separate sections.
 *
 * §7  The mechanism. `next/script` afterInteractive renders null on the server
 *     and creates the element in a client effect, so the measurement id only
 *     reaches the browser as an RSC prop — which requires this file to stay a
 *     SERVER component. Marking it "use client" would bundle lib/env.ts for the
 *     browser, where `process.env` is a shim with no values, and the tag would
 *     vanish from every route with no error. Pinned here so nobody "modernises"
 *     it into a usePathname hook.
 *
 * §8  The security boundary, restated locally rather than borrowed from
 *     verify-branding §15. The measurement id lands in an inline <script>, so a
 *     bad value there is arbitrary JS on every page. Nothing else may be
 *     interpolated into that snippet — in particular not the pathname or query
 *     string, which are attacker-controlled request data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import {
  STAFF_PATH_PREFIXES,
  STRIPPED_QUERY_PARAMS,
} from "../src/app/_components/Analytics";
import { GA_MEASUREMENT_ID_RE } from "../src/lib/env";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function readRepoFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const ANALYTICS_SRC = readRepoFile("src/app/_components/Analytics.tsx");

/**
 * The same file with block comments removed.
 *
 * Needed because Analytics.tsx documents at length the hook it deliberately
 * does NOT use, and a scan for that identifier over the raw text would report a
 * violation that is really an explanation. §7 asserts against the code.
 */
const ANALYTICS_CODE = ANALYTICS_SRC.replace(/\/\*[\s\S]*?\*\//g, "");

/** The measurement id the snippet is executed with. Never a real one. */
const TEST_ID = "G-VERIFYONLY01";
const EXPECTED_LOADER = `https://www.googletagmanager.com/gtag/js?id=${TEST_ID}`;
const SNIPPET_ANCHOR = "{`(function(){";

/**
 * The inline snippet, lifted out of the component source as text.
 *
 * Bounded by the template literal's own backticks, so it is exactly the string
 * React hands to the <script> element — not a paraphrase. The one interpolation
 * the snippet is allowed (§8 proves it is the only one) is substituted with a
 * test id so the extracted text is runnable JavaScript.
 */
function extractSnippet(): string {
  const open = ANALYTICS_SRC.indexOf(SNIPPET_ANCHOR);
  if (open < 0) throw new Error("inline gtag snippet not found in Analytics.tsx");
  const start = open + 2;
  const end = ANALYTICS_SRC.indexOf("`}", start);
  if (end < 0) throw new Error("inline gtag snippet is not terminated");
  return ANALYTICS_SRC.slice(start, end).replace(/\$\{measurementId\}/g, TEST_ID);
}

const SNIPPET = extractSnippet();

type Command = unknown[];

type Run = {
  /** gtag's command queue, in order. Empty when the route guard fired. */
  commands: Command[];
  /** `src` of every <script> the snippet appended. Empty when guarded. */
  loaders: string[];
  /** Whether a callable `window.gtag` was left behind (lib/analyticsEvents.ts needs it). */
  gtagExposed: boolean;
};

/**
 * Run the real snippet against a fake browser and report everything it did.
 *
 * A `node:vm` context and not `new Function`, because the snippet does what
 * every gtag snippet does — assigns `window.dataLayer` and then calls the bare
 * global `gtag`. That only resolves if `window` IS the global object, and a vm
 * context is the cheapest honest way to arrange that.
 */
function runSnippet(href: string): Run {
  const appended: Record<string, unknown>[] = [];
  const sandbox: Record<string, unknown> = {
    URL,
    document: {
      createElement: (tag: string) => ({ tagName: String(tag).toUpperCase() }),
      head: {
        appendChild: (el: Record<string, unknown>) => {
          appended.push(el);
          return el;
        },
      },
    },
  };
  sandbox.window = sandbox;
  let location: Record<string, string>;
  try {
    const u = new URL(href);
    location = { href, origin: u.origin, pathname: u.pathname };
  } catch {
    // Deliberately reachable: §5 feeds a href the URL parser rejects, to prove
    // the snippet's catch branch degrades to a path and never falls back to
    // reporting the raw, unscrubbed URL.
    location = { href, origin: "https://example.org", pathname: "/broken" };
  }
  sandbox.location = location;
  createContext(sandbox);
  runInContext(SNIPPET, sandbox);
  const queue = (sandbox.dataLayer ?? []) as ArrayLike<ArrayLike<unknown>>;
  return {
    commands: Array.from(queue, (args) => Array.from(args)),
    loaders: appended.map((el) => String(el.src ?? "")),
    gtagExposed: typeof sandbox.gtag === "function",
  };
}

/** Everything the snippet does for a bare path on the tenant's host. */
function runPath(path: string): Run {
  return runSnippet(`https://dcica.org${path}`);
}

/** True when the route produced no queue, no loader and no gtag at all. */
function isSilent(run: Run): boolean {
  return run.commands.length === 0 && run.loaders.length === 0 && !run.gtagExposed;
}

/** True when the route initialised the tag and requested exactly one loader. */
function isTracked(run: Run): boolean {
  return (
    run.commands.some((c) => c[0] === "config") &&
    run.loaders.length === 1 &&
    run.loaders[0] === EXPECTED_LOADER &&
    run.gtagExposed
  );
}

/** `page_location` as the snippet would report it for `href`. */
function reportedLocation(href: string): string {
  const config = runSnippet(href).commands.find((c) => c[0] === "config");
  const params = (config?.[2] ?? {}) as Record<string, unknown>;
  return String(params.page_location ?? "");
}

function main() {
  // ── §1 ───────────────────────────────────────────────────────────────────────
  console.log("\n§1 staff / day-of routes send nothing at all");
  // Pinned by name. The list is the fix; a prefix dropped in a refactor is the
  // regression, and no type checker can see it.
  const expectedPrefixes = [
    "/admin",
    "/staff",
    "/dashboard",
    "/station",
    // The merged scan station. /gate and /checkin still redirect to it, and a
    // redirect still renders a pageview at the OLD path, so all three stay.
    "/scan",
    "/gate",
    "/checkin",
    "/badge",
    "/volunteer/checkin",
    "/test-login",
  ];
  check(
    "the exported list is exactly the ten operational prefixes",
    JSON.stringify([...STAFF_PATH_PREFIXES].sort()) ===
      JSON.stringify([...expectedPrefixes].sort()),
    [...STAFF_PATH_PREFIXES].join(" "),
  );
  // The snippet may not interpolate the const (§8), so it holds a literal copy.
  // This is the check that makes that duplication safe.
  const snippetStaff = /var staff = \[([^\]]*)\]/.exec(SNIPPET)?.[1] ?? "";
  const snippetPrefixes = snippetStaff
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
  check("the snippet's literal list matches STAFF_PATH_PREFIXES",
    JSON.stringify(snippetPrefixes) === JSON.stringify([...STAFF_PATH_PREFIXES]),
    snippetPrefixes.join(" "));
  // Behaviour, not membership: no command queue, no loader element, no gtag.
  for (const prefix of expectedPrefixes) {
    check(`silent: ${prefix}`, isSilent(runPath(prefix)));
    // A trailing slash must not be the difference between tracked and silent.
    check(`silent: ${prefix}/`, isSilent(runPath(`${prefix}/`)));
    // Real screens live under the prefix, not at it.
    check(`silent: ${prefix}/anything`, isSilent(runPath(`${prefix}/anything`)));
  }
  // Deep operational paths, shaped like the real ones.
  for (const deep of [
    "/admin/settings/branding",
    "/dashboard/reconciliation",
    "/station/vitals/queue",
    "/gate/scan",
    "/checkin/MC-2026S-0042",
    "/badge/print/MC-2026S-0042",
    "/staff/orders/abc123",
  ]) {
    check(`silent: ${deep}`, isSilent(runPath(deep)));
  }
  // The strongest single statement this suite makes: a volunteer phone on a
  // queue screen makes no request to Google, rather than loading gtag.js and
  // merely withholding the config call.
  check("a suppressed route requests no gtag.js at all",
    runPath("/station/vitals/queue").loaders.length === 0);
  check("a suppressed route leaves window.gtag undefined, so funnel events no-op",
    !runPath("/admin").gtagExposed);

  // ── §2 ───────────────────────────────────────────────────────────────────────
  console.log("\n§2 the public funnel is tracked");
  for (const publicPath of [
    "/",
    "/e/garba-night-2026",
    "/e/medical-camp-2026",
    "/register",
    "/confirm/ord_9f3a",
    "/perform",
    "/perform/apply",
    "/volunteer",
    "/vendors",
    "/volunteers",
    "/volunteers/counselors",
    "/login",
    "/403",
  ]) {
    check(`tracked: ${publicPath}`, isTracked(runPath(publicPath)));
  }
  check("the loader carries the validated measurement id and nothing else",
    runPath("/").loaders[0] === EXPECTED_LOADER, runPath("/").loaders[0]);
  check("the loader is requested exactly once",
    runPath("/register").loaders.length === 1);

  // ── §3 ───────────────────────────────────────────────────────────────────────
  console.log("\n§3 /volunteer/checkin is staff; /volunteer and /volunteers are not");
  check("silent: /volunteer/checkin", isSilent(runPath("/volunteer/checkin")));
  check("silent: /volunteer/checkin/shift-2", isSilent(runPath("/volunteer/checkin/shift-2")));
  check("tracked: /volunteer", isTracked(runPath("/volunteer")));
  check("tracked: /volunteer/ (trailing slash)", isTracked(runPath("/volunteer/")));
  check("tracked: /volunteer/cert", isTracked(runPath("/volunteer/cert")));
  check("tracked: /volunteer/confirm", isTracked(runPath("/volunteer/confirm")));
  // The other half of segment-boundary matching: a longer first segment that
  // merely begins with a suppressed prefix is a DIFFERENT route.
  check("tracked: /volunteers (not a /volunteer prefix match)", isTracked(runPath("/volunteers")));
  check("tracked: /administrators", isTracked(runPath("/administrators")));
  check("tracked: /stationery", isTracked(runPath("/stationery")));
  check("tracked: /gates", isTracked(runPath("/gates")));
  check("tracked: /badges", isTracked(runPath("/badges")));

  // ── §4 ───────────────────────────────────────────────────────────────────────
  console.log("\n§4 consent defaults are emitted BEFORE config");
  const queue = runPath("/").commands;
  const consentIndexes = queue
    .map((c, i) => (c[0] === "consent" && c[1] === "default" ? i : -1))
    .filter((i) => i >= 0);
  const configIndex = queue.findIndex((c) => c[0] === "config");
  check("the snippet emits two consent defaults", consentIndexes.length === 2,
    `${consentIndexes.length}`);
  check("the snippet emits exactly one config",
    queue.filter((c) => c[0] === "config").length === 1);
  // The ordering assertion. gtag DISCARDS a default that lands after config, so
  // an edit that reorders these leaves a compliant-looking source file and a
  // non-compliant browser.
  check("every consent default precedes config",
    configIndex > 0 && consentIndexes.every((i) => i < configIndex),
    `consent at ${consentIndexes.join(",")} / config at ${configIndex}`);
  check("config carries the interpolated measurement id", queue[configIndex]?.[1] === TEST_ID);
  const consents = consentIndexes.map((i) => queue[i][2] as Record<string, unknown>);
  const regional = consents.find((c) => Array.isArray(c.region));
  const global = consents.find((c) => !Array.isArray(c.region));
  check("one consent default is region-scoped, one is global",
    Boolean(regional) && Boolean(global));
  check("the region scope is exactly ['EEA','GB','CH']",
    JSON.stringify(regional?.region) === JSON.stringify(["EEA", "GB", "CH"]),
    JSON.stringify(regional?.region));
  // EEA/UK/CH: denied across the board, which is what makes a cookie banner
  // unnecessary rather than merely absent.
  for (const signal of [
    "ad_storage",
    "ad_user_data",
    "ad_personalization",
    "analytics_storage",
  ]) {
    check(`EEA/GB/CH default denies ${signal}`, regional?.[signal] === "denied",
      String(regional?.[signal]));
  }
  // Everywhere else: measurement on, advertising off — this org runs no ads.
  check("global default grants analytics_storage",
    global?.analytics_storage === "granted", String(global?.analytics_storage));
  for (const signal of ["ad_storage", "ad_user_data", "ad_personalization"]) {
    check(`global default denies ${signal}`, global?.[signal] === "denied",
      String(global?.[signal]));
  }
  // `instanceof Date` is wrong here and the reason is worth writing down: the
  // snippet runs in a vm realm, so its Date is not this realm's Date.
  check("the snippet keeps gtag('js', new Date())",
    queue.some(
      (c) => c[0] === "js" && Object.prototype.toString.call(c[1]) === "[object Date]",
    ));
  // The loader must be appended after the queue is built, or gtag.js can read an
  // empty dataLayer and the consent defaults are lost.
  check("the guard and the queue precede the loader injection in source order",
    SNIPPET.indexOf("var staff") < SNIPPET.indexOf("window.dataLayer") &&
      SNIPPET.indexOf("gtag('config'") < SNIPPET.indexOf("createElement('script')"));

  // ── §5 ───────────────────────────────────────────────────────────────────────
  console.log("\n§5 identifiers never reach page_location");
  check("the denylist is exactly session_id, cancelled, code, token",
    JSON.stringify([...STRIPPED_QUERY_PARAMS]) ===
      JSON.stringify(["session_id", "cancelled", "code", "token"]),
    [...STRIPPED_QUERY_PARAMS].join(" "));
  // Same duplication contract as §1: literal in the snippet, const in the
  // module, pinned equal here.
  const snippetList = /var strip = \[([^\]]*)\]/.exec(SNIPPET)?.[1] ?? "";
  const snippetParams = snippetList
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
  check("the snippet's literal denylist matches STRIPPED_QUERY_PARAMS",
    JSON.stringify(snippetParams) === JSON.stringify([...STRIPPED_QUERY_PARAMS]),
    snippetParams.join(" "));
  // The real one: a live Stripe Checkout Session id on the post-payment return.
  check("session_id is stripped (Stripe cs_live_… on /confirm)",
    reportedLocation("https://dcica.org/confirm/ord_9f3a?session_id=cs_live_a1b2c3d4e5") ===
      "https://dcica.org/confirm/ord_9f3a");
  check("cancelled is stripped (internal order id on the abandon path)",
    reportedLocation("https://dcica.org/register?cancelled=ord_9f3a") ===
      "https://dcica.org/register");
  check("code is stripped (per-person confirmation code)",
    reportedLocation("https://dcica.org/confirm/ord_9f3a?code=MC7Q2XT") ===
      "https://dcica.org/confirm/ord_9f3a");
  check("token is stripped (single-use link token)",
    reportedLocation("https://dcica.org/volunteer/cert?token=eyJhbGciOi") ===
      "https://dcica.org/volunteer/cert");
  check("all four are stripped together",
    reportedLocation(
      "https://dcica.org/confirm/x?session_id=cs_live_1&cancelled=o1&code=C1&token=t1",
    ) === "https://dcica.org/confirm/x");
  check("a repeated denylisted param is fully removed",
    reportedLocation("https://dcica.org/confirm/x?code=A&code=B") ===
      "https://dcica.org/confirm/x");
  check("a URL with no query is reported unchanged",
    reportedLocation("https://dcica.org/register") === "https://dcica.org/register");
  check("the path and host survive scrubbing",
    reportedLocation("https://dcica.org/e/garba-night-2026?session_id=cs_live_1") ===
      "https://dcica.org/e/garba-night-2026");
  // Not a substring match: a param that merely CONTAINS a denylisted name is a
  // different param and must survive.
  check("session_id_hint is not treated as session_id",
    reportedLocation("https://dcica.org/x?session_id_hint=1").includes("session_id_hint=1"));
  // The catch branch. If URL parsing ever fails, the fallback must not be
  // "report the href anyway" — that is the exact leak this section prevents.
  check("an unparseable location degrades to origin + pathname, not the raw href",
    reportedLocation("not a url?session_id=cs_live_1") === "https://example.org/broken");

  // ── §6 ───────────────────────────────────────────────────────────────────────
  console.log("\n§6 campaign attribution survives (denylist, never a wholesale strip)");
  const attributed = reportedLocation(
    "https://dcica.org/e/garba-night-2026?utm_source=facebook&utm_medium=cpc&utm_campaign=garba26&session_id=cs_live_9",
  );
  check("utm_source survives", attributed.includes("utm_source=facebook"), attributed);
  check("utm_medium survives", attributed.includes("utm_medium=cpc"));
  check("utm_campaign survives", attributed.includes("utm_campaign=garba26"));
  check("…while session_id is still gone", !attributed.includes("session_id"));
  check("the query string itself is not dropped", attributed.includes("?"));
  check("utm_term and utm_content survive",
    (() => {
      const out = reportedLocation("https://dcica.org/?utm_term=camp&utm_content=v2&code=X");
      return out.includes("utm_term=camp") && out.includes("utm_content=v2") &&
        !out.includes("code=X");
    })());
  check("click ids (gclid, fbclid, msclkid) survive",
    (() => {
      const out = reportedLocation("https://dcica.org/?gclid=g1&fbclid=f1&msclkid=m1&token=t");
      return out.includes("gclid=g1") && out.includes("fbclid=f1") &&
        out.includes("msclkid=m1") && !out.includes("token=t");
    })());
  check("an unrelated param (ref) survives",
    reportedLocation("https://dcica.org/?ref=newsletter&cancelled=o1") ===
      "https://dcica.org/?ref=newsletter");

  // ── §7 ───────────────────────────────────────────────────────────────────────
  console.log("\n§7 the component stays a server component (why the guard is in JS)");
  // next/script afterInteractive renders null on the server and creates the
  // element in a client effect, so the id only reaches the browser as an RSC
  // prop. "use client" here would bundle lib/env.ts for the browser, where
  // process.env is a shim with no values — and the tag would silently vanish
  // from EVERY route. This is the check that stops that refactor.
  check('Analytics.tsx is NOT a client component',
    !/^\s*"use client"/.test(ANALYTICS_SRC));
  // Checked against the source with block comments removed, because the header
  // comment NAMES the hook it is explaining the absence of — a naive scan of the
  // raw file would fail on the documentation instead of on the code.
  check("it does not import or call a pathname hook",
    !/next\/navigation/.test(ANALYTICS_CODE) && !/usePathname/.test(ANALYTICS_CODE));
  check("it reads the id from validated env, not process.env",
    /env\.NEXT_PUBLIC_GA_MEASUREMENT_ID/.test(ANALYTICS_SRC) &&
      !/process\.env/.test(ANALYTICS_SRC));
  check("default-off survives: no id ⇒ nothing rendered",
    /if\s*\(!measurementId\)\s*return null;/.test(ANALYTICS_SRC));
  check("the loader is still afterInteractive (off the critical path on gym WiFi)",
    /strategy="afterInteractive"/.test(ANALYTICS_SRC));
  // The googletagmanager URL must exist ONLY inside the guarded snippet. A
  // second <Script src> outside it would fetch gtag.js on every staff screen,
  // which is the whole defect this change removes.
  const loaderMentions = (ANALYTICS_SRC.match(/googletagmanager\.com\/gtag\/js/g) ?? []).length;
  check("the loader URL appears exactly once, inside the guarded snippet",
    loaderMentions === 1 &&
      ANALYTICS_SRC.indexOf("googletagmanager.com/gtag/js") >
        ANALYTICS_SRC.indexOf(SNIPPET_ANCHOR),
    `${loaderMentions} mention(s)`);
  check("exactly one script element is rendered",
    (ANALYTICS_SRC.match(/strategy="afterInteractive"/g) ?? []).length === 1 &&
      (ANALYTICS_SRC.match(/<Script id=/g) ?? []).length === 1);
  check("the root layout still mounts <Analytics />",
    /<Analytics\s*\/>/.test(readRepoFile("src/app/layout.tsx")));
  // lib/analyticsEvents.ts fires the funnel events through window.gtag and
  // no-ops when it is missing. The IIFE the guard needs would make a bare
  // `function gtag(){}` local, so the assignment has to be explicit.
  check("window.gtag is exposed globally for lib/analyticsEvents.ts",
    /window\.gtag\s*=/.test(SNIPPET) && runPath("/register").gtagExposed);

  // ── §8 ───────────────────────────────────────────────────────────────────────
  console.log("\n§8 the inline script stays a closed surface");
  // Stated locally rather than leaned on from verify-branding §15: this suite is
  // the one that added a route guard and a scrubbing expression to the snippet,
  // so it owns the proof that nothing request-derived came with them.
  const interpolations = SNIPPET.match(/\$\{[^}]*\}/g) ?? [];
  check("the extracted snippet has no interpolation left but the id",
    interpolations.length === 0, interpolations.join(" "));
  const rawInterpolations =
    ANALYTICS_SRC.slice(ANALYTICS_SRC.indexOf(SNIPPET_ANCHOR)).match(/\$\{[^}]*\}/g) ?? [];
  check("the snippet interpolates ONLY measurementId",
    rawInterpolations.length > 0 &&
      rawInterpolations.every((i) => i === "${measurementId}"),
    rawInterpolations.join(" "));
  // The URL is attacker-controlled request data: anyone can send a visitor to
  // `/register?x=<a closing script tag>`. It reaches gtag as an ARGUMENT computed
  // in the browser, so a hostile URL is a string value while the script body
  // stays constant — asserted from both ends, behaviour and source.
  check("the pathname and URL are read off window.location at run time",
    /window\.location\.pathname/.test(SNIPPET) && /window\.location\.href/.test(SNIPPET));
  const hostileReported = reportedLocation(
    "https://dcica.org/register?x=</script><script>alert(1)</script>&code=A",
  );
  check("a URL carrying a closing script tag is reported as a value, scrubbed",
    hostileReported.startsWith("https://dcica.org/register?x=") &&
      !hostileReported.includes("code=A"),
    hostileReported);
  check("lib/env.ts still gates the id on GA_MEASUREMENT_ID_RE",
    /NEXT_PUBLIC_GA_MEASUREMENT_ID:\s*z\s*\.string\(\)\s*\.regex\(GA_MEASUREMENT_ID_RE/.test(
      readRepoFile("src/lib/env.ts"),
    ));
  check("the regex accepts a real GA4 id", GA_MEASUREMENT_ID_RE.test("G-N37TVHFNTT"));
  for (const bad of [
    "G-ABC</script><script>x()", // breaks out of the script element entirely
    "G-ABC');alert(1);//",        // closes the gtag call, appends a statement
    "G-ABC' + document.cookie + '", // exfiltration by concatenation
    "G-ABC\\'",                   // a quote-escape attempt
    "G-ABC\nalert(1)",            // the snippet is multi-line
  ]) {
    check(`the regex refuses ${JSON.stringify(bad)}`, !GA_MEASUREMENT_ID_RE.test(bad));
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
