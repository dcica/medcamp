/**
 * Tenant-branding check — the parse/validate/fallback layer between
 * `Organization.settings` and the CSS custom properties the whole app reads.
 *
 *   npx tsx scripts/verify-branding.ts
 *
 * Sibling of verify-storage.ts. No database and no network: src/lib/branding.ts
 * is pure by design precisely so this file can exist, and the two source files
 * it reads off disk (globals.css, the STATUS_STYLE tables) are read as TEXT, to
 * pin agreements that no type checker can see.
 *
 * WHY THIS SUITE EARNS ITS PLACE, section by section.
 *
 * §1  The emitted variables and the CSS fallbacks are two independent copies of
 *     the same palette. A themeless tenant renders the CSS copy; a themed one
 *     renders the emitted copy. If they drift, "no visual change" quietly stops
 *     being true and the only symptom is a screenshot nobody took.
 *
 * §2  Hex validation is the CSS-injection boundary. Emitted values land in a
 *     style attribute on <html>, so every non-hex shape that a database column
 *     can hold has to be refused by name, not by hope.
 *
 * §3  Contrast refusal is the point of widening the shape, not a nicety. The
 *     failure it prevents is a volunteer at a gate unable to read a screen.
 *
 * §4  THE MOST VALUABLE SECTION. Every environment currently stores a legacy
 *     `{brand: "#0d6e6e", locale: "en"}` blob — a teal that has never been on
 *     screen, because nothing read it. This section asserts mechanically that
 *     that exact blob renders identically to an empty one, which is the whole
 *     claim that deploying this change repaints nothing.
 *
 * §5  Every other shape a JSON column can hold — absent, null, a string, an
 *     array, a half-filled theme — has to fall back cleanly. The specific bug
 *     being guarded is emitting the literal text "undefined" into CSS.
 *
 * §6  The render-time guard, tested by BYPASSING the schema. The write path that
 *     shipped before this change validated nothing, and `settings` is also
 *     written by seeds and ad-hoc scripts, so the render-time check is not a
 *     duplicate of the write-time one — it is the only check that covers a value
 *     the write path never saw.
 *
 * §7  Asset URLs are handed to next/image, which is configured to allow exactly
 *     one remote host. An arbitrary URL out of the database is an
 *     arbitrary-outbound-request vector the day anybody widens that config.
 *
 * §8  Status pills must NOT be themeable — a brand-red "paid" chip at a gate is
 *     a safety problem, not a styling preference. Asserted against the source.
 *
 * §9  `getActiveOrg()` returns null on a self-hoster's first boot. Resolution
 *     must produce a renderable shell rather than throw.
 *
 * §10 The coordinator's single colour field now writes a real theme, so the
 *     composition it goes through (auto-foreground, then full validation) is
 *     part of the security boundary and not just convenience.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MARK_URL,
  DEFAULT_THEME,
  MIN_CONTRAST,
  brandingStyleText,
  brandingStyleVars,
  contrastRatio,
  isBrandHex,
  resolveBranding,
  sanitizeAssetUrl,
  themeSchema,
  themeWithBrand,
  type Theme,
} from "../src/lib/branding";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function readRepoFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Every CSS custom property the layout can emit, in globals.css spelling. */
const VAR_NAMES = [
  "--brand",
  "--brand-fg",
  "--accent",
  "--accent-fg",
  "--accent-2",
  "--accent-2-fg",
] as const;

/**
 * A theme that differs from DEFAULT_THEME in ALL SIX fields — including the two
 * foregrounds, which is why they are off-white rather than #ffffff. A test theme
 * that happens to share a value with the default cannot tell "the tenant's value
 * arrived" apart from "the fallback rendered", which is the exact confusion this
 * whole change exists to remove.
 */
const OTHER_THEME: Theme = {
  brand: "#4b1d6b",
  brandFg: "#fffdf7",
  accent: "#ffd166",
  accentFg: "#231f20",
  accent2: "#0b5d3b",
  accent2Fg: "#f5fff8",
  wordmark: "OTHERORG",
};

function main() {
  // ── §1 ────────────────────────────────────────────────────────────────────
  console.log("\n§1 the emitted palette and the CSS fallbacks are the same palette");
  const css = readRepoFile("src/app/globals.css");
  const cssVars = new Map<string, string>();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    cssVars.set(m[1], m[2].toLowerCase());
  }
  const defaultByVar: Record<string, string> = {
    "--brand": DEFAULT_THEME.brand,
    "--brand-fg": DEFAULT_THEME.brandFg,
    "--accent": DEFAULT_THEME.accent,
    "--accent-fg": DEFAULT_THEME.accentFg,
    "--accent-2": DEFAULT_THEME.accent2,
    "--accent-2-fg": DEFAULT_THEME.accent2Fg,
  };
  for (const name of VAR_NAMES) {
    // Deleting a fallback is the failure mode here: it is what makes a
    // THEMELESS tenant render correctly, and this change ships themeless.
    check(`globals.css still declares ${name}`, cssVars.has(name));
    check(
      `${name} fallback equals DEFAULT_THEME`,
      cssVars.get(name) === defaultByVar[name].toLowerCase(),
      `css=${cssVars.get(name)} default=${defaultByVar[name]}`,
    );
  }
  const tw = readRepoFile("tailwind.config.ts");
  for (const name of VAR_NAMES) {
    // tailwind.config.ts carries a THIRD copy as `var(--x, #hex)`. It is what
    // renders if the CSS file itself ever fails to load.
    check(`tailwind.config.ts reads ${name}`, tw.includes(`var(${name},`));
  }

  // ── §2 ────────────────────────────────────────────────────────────────────
  console.log("\n§2 hex validation — the CSS-injection boundary");
  check("a canonical hex is accepted", isBrandHex("#0c3543"));
  check("uppercase is accepted", isBrandHex("#0C3543"));
  const rejected: Array<[string, unknown]> = [
    ["three-digit shorthand", "#abc"],
    ["eight-digit with alpha", "#0c3543ff"],
    ["no leading hash", "0c3543"],
    ["a named colour", "red"],
    ["an rgb() function", "rgb(12,53,67)"],
    ["a var() reference", "var(--brand)"],
    ["a declaration terminator", "#0c3543;"],
    ["a rule-closing brace", "#0c3543 } html { display: none } :root {"],
    ["a url() exfiltration", "#000 ; background: url(https://evil.example/x)"],
    ["an expression", "expression(alert(1))"],
    ["trailing whitespace", "#0c3543 "],
    ["embedded newline", "#0c3543\n"],
    ["a comment escape", "#0c3543 /* */"],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 0x0c3543],
    ["an object", { brand: "#0c3543" }],
    ["an array", ["#0c3543"]],
  ];
  for (const [label, value] of rejected) {
    check(`refuses ${label}`, !isBrandHex(value), JSON.stringify(value));
  }

  // ── §3 ────────────────────────────────────────────────────────────────────
  console.log("\n§3 contrast — an unreadable pair is refused, not stored");
  check(
    `the threshold is WCAG AA normal text (${MIN_CONTRAST}:1)`,
    MIN_CONTRAST === 4.5,
    `${MIN_CONTRAST}`,
  );
  check("white on black is 21:1", contrastRatio("#ffffff", "#000000") === 21);
  check("a colour against itself is 1:1", contrastRatio("#0d6e6e", "#0d6e6e") === 1);
  check("the ratio is symmetric",
    contrastRatio("#0c3543", "#ffffff") === contrastRatio("#ffffff", "#0c3543"));
  // Each shipped dcica pair must clear the bar, or the validator would refuse
  // the reference tenant's own reviewed design.
  check("dcica brand/brandFg clears the bar",
    contrastRatio(DEFAULT_THEME.brand, DEFAULT_THEME.brandFg) >= MIN_CONTRAST,
    `${contrastRatio(DEFAULT_THEME.brand, DEFAULT_THEME.brandFg)}:1`);
  check("dcica accent/accentFg clears the bar (saffron needs DARK text)",
    contrastRatio(DEFAULT_THEME.accent, DEFAULT_THEME.accentFg) >= MIN_CONTRAST,
    `${contrastRatio(DEFAULT_THEME.accent, DEFAULT_THEME.accentFg)}:1`);
  check("dcica accent2/accent2Fg clears the bar",
    contrastRatio(DEFAULT_THEME.accent2, DEFAULT_THEME.accent2Fg) >= MIN_CONTRAST,
    `${contrastRatio(DEFAULT_THEME.accent2, DEFAULT_THEME.accent2Fg)}:1`);
  // The concrete mistake: saffron with WHITE text. Valid hexes, 2.14:1, and the
  // exact pair a coordinator picks if nobody stops them.
  const saffronWhite = themeSchema.safeParse({ ...DEFAULT_THEME, accentFg: "#ffffff" });
  check("saffron + white text is REFUSED at save", !saffronWhite.success,
    `${contrastRatio(DEFAULT_THEME.accent, "#ffffff")}:1`);
  check("the refusal names the offending field",
    !saffronWhite.success && saffronWhite.error.issues.some((i) => i.path[0] === "accentFg"));
  const navyOnNavy = themeSchema.safeParse({ ...DEFAULT_THEME, brandFg: "#0c3543" });
  check("brand text identical to its background is REFUSED", !navyOnNavy.success);
  check("a fully valid theme is accepted",
    themeSchema.safeParse(DEFAULT_THEME).success);
  check("an unknown extra key is refused (strict shape)",
    !themeSchema.safeParse({ ...DEFAULT_THEME, onLoad: "x" }).success);
  check("a 9-character wordmark is refused (it must fit a 375px bar)",
    !themeSchema.safeParse({ ...DEFAULT_THEME, wordmark: "NINECHARS" }).success);
  check("an empty wordmark is refused",
    !themeSchema.safeParse({ ...DEFAULT_THEME, wordmark: "   " }).success);

  // ── §4 ────────────────────────────────────────────────────────────────────
  console.log("\n§4 PROOF: deploying this repaints nothing");
  // Byte-identical to the blob sitting in the local, test AND prod organization
  // rows right now. The teal has never been rendered anywhere; the site renders
  // the navy in globals.css. If this section fails, the deploy is a visual change.
  const PROD_SETTINGS = { brand: "#0d6e6e", locale: "en" };
  const fromProd = resolveBranding(PROD_SETTINGS, "DCICA");
  const fromEmpty = resolveBranding({}, "DCICA");
  check("the stored teal IS a valid AA hex — validation alone would honour it",
    isBrandHex(PROD_SETTINGS.brand) &&
      contrastRatio(PROD_SETTINGS.brand, "#ffffff") >= MIN_CONTRAST,
    `${contrastRatio(PROD_SETTINGS.brand, "#ffffff")}:1 on white`);
  check("the live prod blob yields NO theme", fromProd.theme === null);
  check("so NO style attribute is emitted",
    brandingStyleVars(fromProd.theme) === undefined);
  check("prod blob and empty blob resolve identically",
    JSON.stringify(fromProd) === JSON.stringify(fromEmpty),
    JSON.stringify(fromProd));
  check("prod blob and empty blob emit identical CSS (both nothing)",
    brandingStyleText(fromProd.theme) === brandingStyleText(fromEmpty.theme) &&
      brandingStyleText(fromProd.theme) === "");
  check("the teal never appears in the emitted CSS",
    !brandingStyleText(fromProd.theme).includes("0d6e6e"));
  check("the header wordmark is the string the old code hardcoded",
    fromProd.wordmark === "DCICA", fromProd.wordmark);
  check("the header mark is the path the old code hardcoded",
    fromProd.markUrl === "/icon.png", fromProd.markUrl);
  check("the footer name is the string the old code hardcoded",
    fromProd.orgName === "DCICA", fromProd.orgName);

  // ── §5 ────────────────────────────────────────────────────────────────────
  console.log("\n§5 every other shape a JSON column can hold falls back cleanly");
  const shapes: Array<[string, unknown]> = [
    ["undefined settings", undefined],
    ["null settings", null],
    ["empty object", {}],
    ["legacy {brand, locale}", { brand: "#0d6e6e", locale: "en" }],
    ["a bare string", "#0d6e6e"],
    ["an array", [{ brand: "#0d6e6e" }]],
    ["a number", 7],
    ["theme: null", { theme: null }],
    ["theme: a string", { theme: "#0d6e6e" }],
    ["theme: an array", { theme: ["#0d6e6e"] }],
    ["partial theme — brand only", { theme: { brand: "#4b1d6b" } }],
    ["partial theme — one pair, no wordmark",
      { theme: { brand: "#4b1d6b", brandFg: "#ffffff" } }],
    ["partial theme — five of six colours", {
      theme: {
        brand: "#4b1d6b", brandFg: "#ffffff", accent: "#ffd166",
        accentFg: "#231f20", accent2: "#0b5d3b", wordmark: "X",
      },
    }],
    ["theme with one bad hex among six", { theme: { ...OTHER_THEME, accent2: "#zzz" } }],
    ["a hostile blob", {
      theme: { brand: "#000 } * { display: none } :root {", brandFg: "#fff" },
      __proto__: { brand: "#ff0000" },
    }],
  ];
  for (const [label, settings] of shapes) {
    const b = resolveBranding(settings, "DCICA");
    const text = brandingStyleText(b.theme);
    check(`${label}: no theme`, b.theme === null);
    check(`${label}: emits nothing`,
      brandingStyleVars(b.theme) === undefined && text === "", text);
    // The specific bug: `${settings.brand}` on a missing key writes the literal
    // six letters "undefined" into CSS, which is silent and invisible.
    check(`${label}: never emits the string "undefined"`, !text.includes("undefined"));
    check(`${label}: still has a wordmark and a mark`,
      b.wordmark.length > 0 && b.markUrl === DEFAULT_MARK_URL);
  }
  // A partial theme is NOT half-applied: contrast is a property of a pair, so a
  // lone `accent` would be validated against a foreground it never ships with.
  check("a partial theme applies NOTHING rather than one colour",
    brandingStyleText(resolveBranding({ theme: { brand: "#4b1d6b" } }).theme) === "");
  // REGRESSION PIN. The first draft of the schema measured contrast before
  // checking that the values were hex at all, so a single typo'd colour in the
  // database threw out of the ROOT LAYOUT — every page 500s, including /login,
  // with no way to reach the settings screen to fix it. Resolution must be total.
  const malformed: unknown[] = [
    { theme: { ...OTHER_THEME, brand: "#zzzzzz" } },
    { theme: { ...OTHER_THEME, brandFg: "" } },
    { theme: { ...OTHER_THEME, accent: null } },
    { theme: { ...OTHER_THEME, accent2: 0 } },
    { theme: { ...OTHER_THEME, accentFg: {} } },
    { theme: { ...OTHER_THEME, wordmark: 42 } },
  ];
  for (const blob of malformed) {
    let threw = false;
    let text = "?";
    try {
      text = brandingStyleText(resolveBranding(blob, "DCICA").theme);
    } catch {
      threw = true;
    }
    check(`a malformed colour resolves instead of throwing: ${JSON.stringify(blob).slice(0, 62)}`,
      !threw && text === "", threw ? "THREW" : text);
  }

  // ── §6 ────────────────────────────────────────────────────────────────────
  console.log("\n§6 the RENDER-TIME guard, tested by bypassing the schema");
  // These objects never went through themeSchema — exactly like a row written by
  // the pre-change admin action (which validated nothing), a seed, or a script.
  const hostileValues: Array<[string, unknown]> = [
    ["a rule-closing brace", "#000 } html { display: none } :root {"],
    ["a url() exfiltration", "#000; background-image: url(https://evil.example/p)"],
    ["a bare declaration terminator", "red;"],
    ["a var() reference", "var(--x)"],
    ["a number", 12345],
    ["null", null],
    ["undefined", undefined],
    ["an object", { toString: () => "#ff0000" }],
  ];
  for (const [label, value] of hostileValues) {
    const smuggled = { ...DEFAULT_THEME, brand: value } as unknown as Theme;
    const vars = brandingStyleVars(smuggled);
    const text = brandingStyleText(smuggled);
    check(`${label} is dropped at render time`, vars?.["--brand"] === undefined, text);
    // `--brand:` with the colon, so this does not accidentally match `--brand-fg:`.
    check(`${label}: no --brand declaration is emitted at all`,
      !text.includes("--brand:"), text);
    check(`${label} does not emit the string "undefined"`, !text.includes("undefined"));
    // The five siblings that ARE valid still ship — a dropped value falls back
    // to the CSS default, it does not take the rest of the theme down.
    check(`${label}: the five valid siblings still emit`,
      Object.keys(vars ?? {}).length === 5, Object.keys(vars ?? {}).join(","));
  }
  check("every value that survives the guard is a strict hex",
    Object.values(brandingStyleVars(OTHER_THEME) ?? {}).every(isBrandHex));
  check("the emitted text contains no brace, semicolon-chain or url()",
    /^(--[a-z0-9-]+: #[0-9a-fA-F]{6};\s?)+$/.test(brandingStyleText(OTHER_THEME)),
    brandingStyleText(OTHER_THEME));

  // ── §7 ────────────────────────────────────────────────────────────────────
  console.log("\n§7 asset URLs are restricted to this origin and the configured host");
  check("the app's own icon path is allowed",
    sanitizeAssetUrl("/icon.png") === "/icon.png");
  check("a nested same-origin path is allowed",
    sanitizeAssetUrl("/brand/logo-2x.png") === "/brand/logo-2x.png");
  const badUrls: Array<[string, string]> = [
    ["an arbitrary https host", "https://evil.example/logo.png"],
    ["an http host", "http://evil.example/logo.png"],
    ["a protocol-relative //host", "//evil.example/logo.png"],
    ["a data: URI", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["a javascript: URI", "javascript:alert(1)"],
    ["a file: URI", "file:///etc/passwd"],
    ["a path traversal", "/../../etc/passwd"],
    ["a backslash path", "\\\\evil.example\\logo.png"],
    ["a path with a query string", "/icon.png?x=1"],
    ["a path with a fragment", "/icon.png#x"],
    ["a path with a quote", '/icon.png" onerror="alert(1)'],
    ["a relative path", "icon.png"],
    ["whitespace only", "   "],
    ["a look-alike host", "https://supabase.co.evil.example/storage/v1/object/public/a.png"],
    ["an over-long URL", `/${"a".repeat(600)}.png`],
  ];
  for (const [label, url] of badUrls) {
    check(`refuses ${label}`, sanitizeAssetUrl(url) === null, url.slice(0, 48));
  }
  // A disallowed URL that somehow got stored must FALL BACK, not render.
  const badMark = resolveBranding({
    theme: { ...OTHER_THEME, markUrl: "https://evil.example/logo.png" },
  });
  check("a theme carrying a disallowed markUrl is refused wholesale at save",
    !themeSchema.safeParse({ ...OTHER_THEME, markUrl: "https://evil.example/logo.png" })
      .success);
  check("and at render time the mark falls back to /icon.png",
    badMark.markUrl === DEFAULT_MARK_URL, badMark.markUrl);
  check("a theme with no lockup reports null rather than a URL",
    resolveBranding({ theme: OTHER_THEME }).lockupUrl === null);
  // Same-origin assets work with Supabase entirely unconfigured (local Docker
  // dev), and in that state NO offsite URL is admissible at all.
  check("same-origin paths work without any storage provider configured",
    sanitizeAssetUrl("/icon.png") === "/icon.png");

  // ── §8 ────────────────────────────────────────────────────────────────────
  console.log("\n§8 status pills are NOT themeable");
  const statusFiles = [
    "src/app/admin/page.tsx",
    "src/app/admin/camps/page.tsx",
    "src/app/admin/camps/[id]/page.tsx",
    "src/app/volunteers/RosterView.tsx",
  ];
  for (const file of statusFiles) {
    const src = readRepoFile(file);
    const start = src.indexOf("STATUS_STYLE");
    const table = src.slice(start, src.indexOf("};", start));
    check(`${file}: has a STATUS_STYLE table`, start !== -1);
    // A brand-red "paid" chip at a gate would read as a safety signal. Status
    // colour is meaning, not identity, so it must not follow a tenant's palette.
    check(`${file}: STATUS_STYLE uses no brand/accent token`,
      !/\b(brand|accent2?)\b/.test(table));
    check(`${file}: STATUS_STYLE uses no CSS variable`, !table.includes("var(--"));
  }
  // Themes must not touch the fixed body/page colours either.
  check("body text #16201f stays fixed in globals.css", css.includes("color: #16201f"));
  check("page background #f7faf9 stays fixed in globals.css",
    css.includes("background: #f7faf9"));

  // ── §9 ────────────────────────────────────────────────────────────────────
  console.log("\n§9 a null org (getActiveOrg's fallback) still renders");
  // The self-hoster's first boot: DEFAULT_ORG_SLUG matches nothing and the
  // organizations table is empty, so getActiveOrg() returns null.
  const nullOrg = resolveBranding(undefined, undefined);
  check("resolution does not throw", Boolean(nullOrg));
  check("no theme is emitted", brandingStyleVars(nullOrg.theme) === undefined);
  check("the header still has a wordmark", nullOrg.wordmark.length > 0, nullOrg.wordmark);
  check("the header still has a mark", nullOrg.markUrl === DEFAULT_MARK_URL);
  check("the footer still has a name", nullOrg.orgName.length > 0, nullOrg.orgName);
  check("a null name falls back rather than rendering 'null'",
    !resolveBranding({}, null).orgName.includes("null"));
  check("a whitespace-only org name falls back",
    resolveBranding({}, "   ").orgName === "DCICA");

  // ── §10 ───────────────────────────────────────────────────────────────────
  console.log("\n§10 a stored theme reaches the emitted style block");
  const themed = resolveBranding({ theme: OTHER_THEME }, "Other Org");
  check("the theme parses", themed.theme !== null);
  const themedVars = brandingStyleVars(themed.theme) ?? {};
  check("all six variables are emitted", Object.keys(themedVars).length === 6,
    Object.keys(themedVars).join(","));
  for (const name of VAR_NAMES) {
    check(`${name} is present and differs from the default`,
      isBrandHex(themedVars[name]) &&
        themedVars[name].toLowerCase() !== defaultByVar[name].toLowerCase(),
      themedVars[name]);
  }
  check("the tenant wordmark wins over the org name",
    themed.wordmark === OTHER_THEME.wordmark, themed.wordmark);
  check("the footer uses the full org name, not the wordmark",
    themed.orgName === "Other Org", themed.orgName);
  check("the wordmark falls back to the org name when the theme omits one",
    resolveBranding({}, "Other Org").wordmark === "Other Org");

  console.log("\n§11 the coordinator's single colour field writes a real theme");
  const dark = themeWithBrand(null, "#4B1D6B");
  check("a dark brand is accepted", dark.ok);
  check("it is normalized to lowercase", dark.ok && dark.theme.brand === "#4b1d6b");
  check("a dark brand gets WHITE text", dark.ok && dark.theme.brandFg === "#ffffff");
  const pale = themeWithBrand(null, "#ffd166");
  check("a pale brand is accepted", pale.ok);
  check("a pale brand gets DARK text, not white",
    pale.ok && pale.theme.brandFg === DEFAULT_THEME.accentFg,
    pale.ok ? pale.theme.brandFg : "");
  check("the other two pairs are left alone",
    dark.ok && dark.theme.accent === DEFAULT_THEME.accent &&
      dark.theme.accent2 === DEFAULT_THEME.accent2);
  // #7e7e7e reaches 4.06:1 against white and 4.10:1 against the dark token — a
  // mid-grey neither text colour can carry. It must be refused rather than
  // shipped at 4:1, which is the failure "pick the better of two" hides.
  check("a mid-tone neither text token can carry is REFUSED",
    !themeWithBrand(null, "#7e7e7e").ok,
    `white ${contrastRatio("#7e7e7e", "#ffffff")}:1, dark ${contrastRatio("#7e7e7e", DEFAULT_THEME.accentFg)}:1`);
  check("a non-hex from the form is refused", !themeWithBrand(null, "red").ok);
  check("an injection-shaped value from the form is refused",
    !themeWithBrand(null, "#000 } html { display: none } :root {").ok);
  check("the composed theme survives its own schema",
    dark.ok && themeSchema.safeParse(dark.theme).success);
  check("an existing wordmark and assets are preserved",
    (() => {
      const r = themeWithBrand({ ...OTHER_THEME, markUrl: "/icon.png" }, "#123456");
      return r.ok && r.theme.wordmark === OTHER_THEME.wordmark &&
        r.theme.markUrl === "/icon.png";
    })());
  // Saving the colour the site already renders must be a no-op, so a coordinator
  // who only edits the org name cannot repaint the site by accident.
  const noop = themeWithBrand(null, DEFAULT_THEME.brand);
  check("saving the current brand reproduces DEFAULT_THEME exactly",
    noop.ok && JSON.stringify(noop.theme) === JSON.stringify(DEFAULT_THEME));
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
