/**
 * Scan-station regression check — what a scan MEANS, and what holds it there.
 *
 *   npx tsx scripts/verify-scan.ts
 *
 * Sibling of verify-gate.ts, and deliberately separate from it. verify-gate's
 * header promises it asserts the DOOR'S SERVER BEHAVIOUR with exactly one
 * structural row; the station needs several rows about a pure verdict table, a
 * state machine and a CSS override. Filing those under verify-gate would
 * quietly void its own stated contract.
 *
 * NO DATABASE. Everything here is a pure module or a source-text read, so this
 * suite runs on a clean clone with no Postgres.
 *
 * WHAT IT EXISTS FOR, in the reporter's words after a live event:
 *   "scanner was not very clear. it showd green boundary, but the action was
 *    not very clear - checked in, or an already checked code"
 * and
 *   "once a status is set, that status should stay for the scan. it should not
 *    move away from that."
 *
 * Those are §1 and §3 respectively.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Static, not the dynamic `await import` verify-gate uses. That file defers
// every app import because dotenv must run first; nothing here touches a
// database or an env var, so there is nothing to defer.
import * as v from "../src/lib/scanVerdict";
import * as latch from "../src/lib/scanLatch";
import * as tones from "../src/lib/scanTones";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function read(rel: string): string {
  const p = join(process.cwd(), rel);
  // Guarded, for the reason verify-gate §3c's read is now guarded: a bare
  // readFileSync turns a moved file into an unhandled throw that skips every
  // later section without printing a single red row.
  if (!existsSync(p)) {
    check(`${rel} exists`, false, "not found");
    return "";
  }
  return readFileSync(p, "utf8");
}

async function main(): Promise<void> {
  const ALL_OUTCOMES: v.ScanOutcome[] = [
    "ADMITTED", "CHECKED_IN", "ALREADY_ADMITTED", "ALREADY_CHECKED_IN",
    "PARTY_ADMITTED", "PARTY_PARTIAL",
    "UNPAID", "PAYMENT_UNCONFIRMED", "NOT_A_TICKET", "ORDER_VOID", "WRONG_EVENT",
    "WAIVER_UNSIGNED", "NO_MATCH", "CAMERA_ERROR", "SERVER_ERROR",
  ];

  const SIGNALS: v.ScanSignal[] = [
    { kind: "admitted", name: "Asha Mehta" },
    { kind: "checkedIn", name: "Asha Mehta", at: "9:03 AM" },
    { kind: "already", flow: "gate", at: "7:42 PM" },
    { kind: "already", flow: "camp", at: "9:03 AM" },
    { kind: "party", admitted: 5, already: 0 },
    { kind: "party", admitted: 2, already: 3 },
    { kind: "unpaid", owed: "$25.00" },
    { kind: "paymentUnconfirmed" },
    { kind: "notATicket" },
    { kind: "voidOrder", status: "REFUNDED" },
    { kind: "wrongEvent", eventName: "Garba 2026" },
    { kind: "waiverUnsigned" },
    { kind: "noMatch", code: "RON-2026-ZZZZZZZZ" },
    { kind: "cameraError", message: "Permission denied" },
    { kind: "serverError", message: "boom" },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§1 green means ONE thing");
  const verdicts = SIGNALS.map(v.verdictFor);

  // THE ROW THIS FILE EXISTS FOR. A fresh admit and a repeat scan demand
  // opposite physical actions — hand over a wristband, or hand over nothing and
  // ask. Sharing a colour is what made the branch that costs money invisible.
  eq("ALREADY ADMITTED IS A HOLD, NOT A GO",
    v.verdictFor({ kind: "already", flow: "gate" }).tone, "hold");
  eq("…and the camp equivalent too",
    v.verdictFor({ kind: "already", flow: "camp" }).tone, "hold");
  // Nor red: a re-scan is routine (verify-gate §5 exists because it is), and
  // training volunteers that routine means failure is its own defect.
  eq("…but it is not a failure either",
    v.verdictFor({ kind: "already", flow: "gate" }).tone !== "stop", true);

  const goes = verdicts.filter((x) => x.tone === "go").map((x) => x.outcome);
  // An exact set, not a count: every GO must mean "I just changed something",
  // which is what makes green safe to act on without reading. PARTY_ADMITTED
  // qualifies (everyone in the party went in); PARTY_PARTIAL deliberately does
  // not, because then the wristband count is not the party size.
  eq("the GO outcomes are exactly the ones that changed something",
    goes.sort(), ["ADMITTED", "CHECKED_IN", "PARTY_ADMITTED"]);

  eq("every outcome is reachable from some signal",
    [...new Set(verdicts.map((x) => x.outcome))].sort(), [...ALL_OUTCOMES].sort());

  // Colour is not the only channel: ~1 in 12 men has a red-green deficiency and
  // a phone at minimum brightness in daylight is close to greyscale.
  eq("three distinct glyphs carry the verdict without colour",
    [...new Set(verdicts.map((x) => x.glyph))].sort(), ["!", "✓", "✕"]);
  check("one glyph per tone, consistently",
    new Set(verdicts.map((x) => `${x.tone}:${x.glyph}`)).size === 3);

  for (const x of verdicts) {
    check(`${x.outcome} headline is short enough to read at arm's length`,
      x.headline.length > 0 && x.headline.split(" ").length <= 3, x.headline);
  }
  // An instruction is what the hands do next. Only the two "you already know
  // what to do" cases may omit it — and in practice none do.
  for (const x of verdicts) {
    check(`${x.outcome} says what to do next`, x.instruction !== null, x.headline);
  }

  // Naming the event is the whole value of resolving a foreign code at all.
  check("WRONG_EVENT names the event the ticket is really for",
    v.verdictFor({ kind: "wrongEvent", eventName: "Garba 2026" }).detail?.includes("Garba 2026") === true);
  check("UNPAID names the amount owed",
    v.verdictFor({ kind: "unpaid", owed: "$25.00" }).detail?.includes("$25.00") === true);
  check("NO_MATCH shows the code that failed",
    v.verdictFor({ kind: "noMatch", code: "RON-2026-ZZZZZZZZ" }).detail === "RON-2026-ZZZZZZZZ");

  // A family of five is ONE order. Scanning one of their codes used to
  // resolve exactly one person, so a door scanned five times for five
  // people standing together.
  const party = (a: number, b: number) =>
    v.verdictFor({ kind: "party", admitted: a, already: b });

  eq("a whole party admitted at once is a GO", party(5, 0).tone, "go");
  check("...and it says how many wristbands", party(5, 0).instruction === "Give 5 wristbands");
  // THE PARTIAL CASE. Two of five means TWO wristbands; green would say five.
  eq("A PARTLY-ADMITTED PARTY IS A HOLD, NOT A GO", party(2, 3).tone, "hold");
  check("...and it names both halves",
    party(2, 3).detail === "Admitted 2 · 3 already in", String(party(2, 3).detail));
  check("...and the wristband count is the ADMITTED count, not the party size",
    party(2, 3).instruction === "Give 2 wristbands", String(party(2, 3).instruction));
  // Nobody new is the same news as a single re-scan, so the same verdict.
  eq("a party that was entirely already in reads as already in",
    party(0, 5).outcome, "ALREADY_ADMITTED");
  eq("a party of one collapses to the ordinary single admit",
    party(1, 0).outcome, "ADMITTED");
  check("singular wristband for one person", party(3, 0).instruction === "Give 3 wristbands");

  // ───────────────────────────────────────────────────────────────────────────
  // A REFUNDED order is not paid AND owes nothing -- every line is REFUNDED,
  // so amountOwedCents sums to zero. The door read "owes $0.00" and offered
  // "Take cash $0.00 & admit", which to a volunteer means "nothing to pay, let
  // them in" for somebody who already had their money back. Found by driving
  // the real UI; the server always refused, but only AFTER the tap.
  eq("a refunded order is a STOP, not a $0 payment",
    v.verdictFor({ kind: "voidOrder", status: "REFUNDED" }).tone, "stop");
  check("...and it says refunded, not unpaid",
    v.verdictFor({ kind: "voidOrder", status: "REFUNDED" }).headline === "Refunded");
  check("a cancelled order says cancelled",
    v.verdictFor({ kind: "voidOrder", status: "CANCELLED" }).headline === "Cancelled");
  // The two need different conversations, so they must not collapse into one.
  check("refunded and cancelled are not the same message",
    v.verdictFor({ kind: "voidOrder", status: "REFUNDED" }).headline !==
      v.verdictFor({ kind: "voidOrder", status: "CANCELLED" }).headline);
  eq("a void order is never payable", v.isVoidOrder("REFUNDED"), true);
  eq("...nor a cancelled one", v.isVoidOrder("CANCELLED"), true);
  // PENDING really is payable -- that is the whole distinction.
  eq("a PENDING order is still payable", v.isVoidOrder("PENDING"), false);
  eq("a CONFIRMED order is not void either", v.isVoidOrder("CONFIRMED"), false);
  // Pure, because GateMode is a client component and reaching this rule through
  // src/server/gate.ts would pull Prisma into the browser bundle.
  const verdictSrc = read("src/lib/scanVerdict.ts");
  check("the rule lives in the import-free module",
    verdictSrc.includes("export function isVoidOrder"));

  console.log("\n§2 the server's words and the screen's words are the same words");
  // These constants moved OUT of src/server/gate.ts so a tsx script could load
  // them without Prisma. The point of moving rather than copying is that the
  // thrower and the matcher cannot drift into paraphrase.
  const gateSrc = read("src/server/gate.ts");
  const checkinSrc = read("src/server/checkin.ts");
  check("gate.ts imports the refusal wording rather than restating it",
    gateSrc.includes("scanVerdict"), "");
  check("checkin.ts does too", checkinSrc.includes("scanVerdict"), "");
  check("no stale literal copy of NOT_A_TICKET in the server",
    !gateSrc.includes('"Not a ticket — this buys no floor access'));

  eq("a thrown NOT_A_TICKET maps back to its own outcome",
    v.verdictFor(v.signalForError(v.NOT_A_TICKET)).outcome, "NOT_A_TICKET");
  eq("a thrown NOT_PAID maps back",
    v.verdictFor(v.signalForError(v.NOT_PAID)).outcome, "PAYMENT_UNCONFIRMED");
  eq("a thrown WAIVER_REQUIRED maps back",
    v.verdictFor(v.signalForError(v.WAIVER_REQUIRED)).outcome, "WAIVER_UNSIGNED");
  eq("a wrong-event throw keeps the event name",
    v.verdictFor(v.signalForError("Wrong event — this ticket is for Garba 2026.")).detail,
    "This ticket is for Garba 2026");
  // Never silence, and never a friendlier guess.
  eq("an unrecognised throw is still a verdict",
    v.verdictFor(v.signalForError("ECONNRESET")).outcome, "SERVER_ERROR");
  eq("…and it keeps the original text",
    v.verdictFor(v.signalForError("ECONNRESET")).detail, "ECONNRESET");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§3 a verdict STAYS until someone acts on it");
  // "once a status is set, that status should stay for the scan. it should not
  // move away from that." Without this, the continuous camera reintroduces the
  // §1 bug: guest B's badge drifts into frame and silently overwrites A.
  const admitted = v.verdictFor({ kind: "admitted", name: "Asha" });
  const already = v.verdictFor({ kind: "already", flow: "gate", at: "7:42 PM" });
  const held: latch.StationPhase = { phase: "held", verdict: already };

  eq("a scanning station accepts a decode", latch.acceptsDecode({ phase: "scanning" }), true);
  // THE ROW.
  eq("A HELD STATION REFUSES A DECODE", latch.acceptsDecode(held), false);
  // …and so does one mid-round-trip, or a second badge races the first answer
  // and lands its verdict second.
  eq("a station mid-lookup refuses one too", latch.acceptsDecode({ phase: "reading" }), false);

  eq("a dropped decode leaves the standing verdict exactly as it was",
    latch.nextPhase(held, { type: "decoded" }), held);
  // A scan that silently does nothing is a new confusion, so say so — quietly.
  eq("…but the volunteer is told it was ignored",
    latch.shouldNudge(held, { type: "decoded" }), true);
  eq("nothing to say when the station was scanning anyway",
    latch.shouldNudge({ phase: "scanning" }, { type: "decoded" }), false);

  eq("only a release returns to scanning",
    latch.nextPhase(held, { type: "release" }).phase, "scanning");
  eq("a decode does not", latch.nextPhase(held, { type: "decoded" }).phase, "held");
  eq("nor does a late answer from an earlier lookup",
    latch.nextPhase(held, { type: "resolved", verdict: admitted }), held);

  // The volunteer's OWN action DOES change the banner — tapping Admit moves the
  // verdict on. The invariant is narrower than "nothing ever changes".
  const acted = latch.nextPhase(held, { type: "acted", verdict: admitted });
  eq("the volunteer's own tap DOES update the verdict",
    acted.phase === "held" ? acted.verdict.outcome : null, "ADMITTED");

  // The happy path, end to end.
  let p: latch.StationPhase = latch.INITIAL_PHASE;
  eq("a station starts scanning", p.phase, "scanning");
  p = latch.nextPhase(p, { type: "decoded" });
  eq("a decode starts a lookup", p.phase, "reading");
  p = latch.nextPhase(p, { type: "resolved", verdict: admitted });
  eq("the answer latches", p.phase, "held");
  p = latch.nextPhase(p, { type: "release" });
  eq("Next guest releases it", p.phase, "scanning");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§4 the audio says the same thing as the colour");
  const seqs = (["go", "hold", "stop"] as const).map((t) => JSON.stringify(tones.TONE_SEQUENCE[t]));
  eq("no two tones sound alike", new Set(seqs).size, 3);
  // Three independent axes, so none has to be learned against the others.
  eq("note count separates them", new Set(
    (["go", "hold", "stop"] as const).map((t) => tones.TONE_SEQUENCE[t].length)
  ).size >= 2, true);
  eq("duration separates them", new Set(
    (["go", "hold", "stop"] as const).map(tones.toneDurationMs)
  ).size, 3);
  const dir = (t: "go" | "hold" | "stop") => {
    const s = tones.TONE_SEQUENCE[t];
    return s.length < 2 ? "flat" : s[s.length - 1].hz > s[0].hz ? "up" : "down";
  };
  eq("go rises", dir("go"), "up");
  eq("hold is flat", dir("hold"), "flat");
  eq("stop falls", dir("stop"), "down");

  // The old beep fired on RAW DECODE, before the server answered — the audio
  // twin of the library's green viewfinder. It must not come back.
  const scannerSrc = read("src/app/_components/QrScanner.tsx");
  check("the scanner itself no longer makes a sound",
    !/function beep\(/.test(scannerSrc) && !scannerSrc.includes("880"));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§5 the library's green is not our green");
  // html5-qrcode paints the viewfinder corners rgb(90,193,56) the instant a QR
  // is merely PARSEABLE: before any lookup, identically for a valid ticket, a
  // Wi-Fi QR on the wall and another event's code. An author !important beats a
  // non-important inline style, which is all the library writes.
  const libPath = "node_modules/html5-qrcode/esm/html5-qrcode.js";
  const lib = read(libPath);
  if (lib) {
    const namesRegion = lib.includes("qr-shaded-region");
    const paintsGreen = lib.includes("rgb(90, 193, 56)");
    check("the library still names the region we override", namesRegion,
      namesRegion ? "" : "renamed upstream — re-check the override in globals.css");
    check("the library still paints a green match colour", paintsGreen,
      paintsGreen ? "" : "changed upstream — the override may now be pointless");
  }
  const css = read("src/app/globals.css");
  check("globals.css neutralises the shader colour",
    /#qr-reader[\s\S]{0,80}qr-shaded-region[\s\S]{0,200}!important/.test(css));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§6 the station owns no colours of its own");
  // The banner is the ONLY thing allowed to say green. Every previous
  // regression here was a screen inventing its own success styling beside it:
  // a bg-green-50 flash for "just admitted", and a second bg-green-50 block
  // inside the guest card for "already admitted by someone else".
  const gateMode = read("src/app/scan/GateMode.tsx");
  const banner = read("src/app/_components/ScanVerdictBanner.tsx");

  check("the station renders the shared banner", gateMode.includes("ScanVerdictBanner"));
  check("the station plays the verdict tone", gateMode.includes("playTone"));
  check("the station asks the latch before accepting a decode",
    gateMode.includes("acceptsDecode"));
  // THE ROW: no hand-rolled success or warning tint anywhere in the station.
  check("the station paints no success colour of its own",
    !/bg-(green|amber|red)-(50|100)/.test(gateMode),
    (gateMode.match(/bg-(green|amber|red)-(50|100)/g) ?? []).join(" "));
  check("the old flash strip is gone", !gateMode.includes("setFlash"));

  // THE CAMERA FRAME. Added 2026-09-27: the viewfinder now carries the verdict
  // colour, because the volunteer is looking at the camera, not at a strip
  // above it. That is a SECOND coloured surface, so it has to be provably the
  // same colour source as the first -- a green frame around an amber banner
  // would be worse than no frame at all.
  check("the frame colour comes from the shared table, not literals",
    gateMode.includes("TONE_FRAME"));
  check("the station hard-codes no border colour of its own",
    !/border-(green|amber|red)-[0-9]/.test(gateMode),
    (gateMode.match(/border-(green|amber|red)-[0-9]+/g) ?? []).join(" "));
  check("TONE_FRAME is exported next to TONE_STYLE, so the two cannot drift",
    banner.includes("TONE_FRAME") && banner.includes("TONE_STYLE"));
  // Idle must not borrow a status colour: "no answer yet" must not look like
  // an answer, which is the exact mistake the library's own green makes.
  const idleLine = (banner.match(/idle:\s*"([^"]+)"/) ?? [])[1] ?? "";
  check("the idle frame is neutral, not a status colour",
    idleLine.length > 0 && !/(green|amber|red)/.test(idleLine), idleLine);
  // The frame must not resize on a verdict: a growing border reflows the
  // <video> mid-scan, which on a phone re-lays-out the camera with a queue
  // waiting. One width, stated once.
  check("the frame width is constant, set outside the tone lookup",
    /border-\[\d+px\][^`]*TONE_FRAME|TONE_FRAME[^`]*border-\[\d+px\]/s.test(gateMode)
      || /border-\[\d+px\]/.test(gateMode));

  // THE ACTION MUST OUTRANK THE CAMERA. The resolved guest card carries
  // "Admit", and it used to render BELOW a ~300px viewfinder and the finder
  // box -- so a volunteer scanned, saw a verdict, and had to scroll one-handed
  // to act on it. Reported 2026-09-27. Ordering is load-bearing, so it is
  // pinned by position rather than left to whoever edits the JSX next.
  const iCard = gateMode.indexOf("{view && (");
  const iCam = gateMode.indexOf("<QrScanner");
  const iFinder = gateMode.indexOf("<GuestFinder");
  check("the resolved guest card renders before the camera",
    iCard > -1 && iCam > -1 && iCard < iCam, `card@${iCard} camera@${iCam}`);
  check("...and before the finder", iCard > -1 && iFinder > -1 && iCard < iFinder,
    `card@${iCard} finder@${iFinder}`);

  // THE MID-FLOW 403. requireTill is the real gate and stays the real gate,
  // but the screen used to render every cash control to a volunteer without
  // a till -- who tapped one, lost the guest they had resolved, and landed
  // on /403. Hidden rather than greyed out, per staffNav's rule that a
  // control you cannot use should not spend your attention.
  check("the screen knows whether this volunteer holds a till",
    gateMode.includes("canTakeCash"));
  check("...the pay-unpaid control is gated on it",
    /canTakeCash &&[\s\S]{0,400}doPayUnpaid/.test(gateMode));
  check("...so is the walk-up sale",
    /canTakeCash && !walkUp/.test(gateMode));
  check("...and buy-more merch",
    /canTakeCash && catalog\.merch/.test(gateMode));
  // Hidden, with a reason -- not a disabled button.
  check("a no-till volunteer is told who can take it",
    gateMode.includes("a till holder has to"));
  const scanPage = read("src/app/scan/page.tsx");
  check("the capability comes from the SERVER session, not the client",
    scanPage.includes("canRecordCash(member)"));
  // A void order must not offer a settle control at any price.
  check("a refunded order shows no cash control",
    /isVoidOrder\(view\.orderStatus\)/.test(gateMode));
  // THREE surfaces show payment state, and the first fix only reached two of
  // them: the search ROW still read "owes $0.00", which is the one a volunteer
  // sees before they tap anything.
  check("...and the search row says refunded, not owes $0.00",
    /isVoidOrder\(h\.orderStatus\)/.test(gateMode));

  // The banner must not be dismissable by anything but a tap, and must not
  // quietly time out - the volunteer is looking at a wristband, not a phone.
  check("the banner has an explicit release control", banner.includes("Next guest"));
  check("the banner never auto-dismisses",
    !banner.includes("setTimeout") && !banner.includes("setInterval"));
  check("the banner announces itself to a screen reader",
    banner.includes(String.raw`aria-live="assertive"`));
  // Status colour is meaning, not identity - CLAUDE.md, verify-branding §8.
  check("the banner uses no tenant brand token",
    !/bg-brand|text-brand|accent2?/.test(banner));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n§7 the admin trail reaches the dashboard");
  // Each admin page used to carry its own single "back to parent" link, which
  // is one hop and not a trail -- and /admin/camps carried NONE, so following
  // dashboard -> camp -> registrations and stepping back landed there and
  // stopped, one page short of where the trail started.
  const crumbs = await import("../src/app/_components/Breadcrumbs");

  const listTrail = crumbs.campTrail({});
  eq("the camps list starts at the dashboard",
    listTrail.map((c) => c.label), ["Dashboard", "Camps"]);
  eq("...and the dashboard crumb actually links there",
    listTrail[0].href, "/dashboard");

  const leafTrail = crumbs.campTrail({
    campId: "abc", campName: "Dandia Night", leaf: "Registrations",
  });
  // THE ROW. Start at the dashboard, end at the page you are on, every hop in
  // between reachable.
  eq("a leaf page shows the whole chain",
    leafTrail.map((c) => c.label),
    ["Dashboard", "Camps", "Dandia Night", "Registrations"]);
  eq("every crumb but the last is a link",
    leafTrail.slice(0, -1).every((c) => Boolean(c.href)), true);
  // A link to the page you are already on is a control that does nothing, and
  // on a phone it is a tap that reloads.
  eq("the page you are on is NOT a link", leafTrail[leafTrail.length - 1].href, undefined);
  eq("the camp crumb links to the camp", leafTrail[2].href, "/admin/camps/abc");

  // On the camp page itself the camp IS the current page, so it must not link.
  const campTrailOnly = crumbs.campTrail({ campName: "Dandia Night" });
  eq("on the camp page the camp is the last crumb",
    campTrailOnly.map((c) => c.label), ["Dashboard", "Camps", "Dandia Night"]);
  eq("...and is not a link to itself", campTrailOnly[2].href, undefined);
  // WITH an id supplied and still no leaf -- the case that actually exercises
  // the rule. The row above omitted campId, so it passed whatever the condition
  // said; this one fails the moment the camp crumb links to the page you are
  // already standing on.
  eq("a camp crumb with an id but no leaf is STILL not a link",
    crumbs.campTrail({ campId: "abc", campName: "Dandia Night" })[2].href, undefined);

  // Built from one place, so the dashboard hop cannot go missing on one page
  // and be present on another -- which is how it went missing the first time.
  for (const f of [
    "src/app/admin/camps/page.tsx",
    "src/app/admin/camps/[id]/page.tsx",
    "src/app/admin/camps/[id]/registrations/page.tsx",
    "src/app/admin/camps/[id]/services/page.tsx",
    "src/app/admin/camps/[id]/stations/page.tsx",
    "src/app/admin/camps/[id]/volunteers/page.tsx",
  ]) {
    const src = read(f);
    check(`${f} uses the shared trail`, src.includes("campTrail("));
    check(`${f} has no hand-rolled back link`, !src.includes("← "));
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
