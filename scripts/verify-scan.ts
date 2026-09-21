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
    "UNPAID", "PAYMENT_UNCONFIRMED", "NOT_A_TICKET", "WRONG_EVENT",
    "WAIVER_UNSIGNED", "NO_MATCH", "CAMERA_ERROR", "SERVER_ERROR",
  ];

  const SIGNALS: v.ScanSignal[] = [
    { kind: "admitted", name: "Asha Mehta" },
    { kind: "checkedIn", name: "Asha Mehta", at: "9:03 AM" },
    { kind: "already", flow: "gate", at: "7:42 PM" },
    { kind: "already", flow: "camp", at: "9:03 AM" },
    { kind: "unpaid", owed: "$25.00" },
    { kind: "paymentUnconfirmed" },
    { kind: "notATicket" },
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
  eq("exactly two outcomes are GO, and both mean 'I just changed something'",
    goes.sort(), ["ADMITTED", "CHECKED_IN"]);

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

  // ───────────────────────────────────────────────────────────────────────────
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
