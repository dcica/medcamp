---
title: Design System
nav_order: 3
---

# Design System
{: .fs-9 }

The visual language for every dcica platform screen and printed artifact — tokens, type, and component anatomy.
{: .fs-6 .fw-300 }

---

<style>
/* All preview styles are scoped under .ds to avoid colliding with the docs theme. */
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap');

.ds {
  /* —— Chrome (neutral, recedes) —— */
  --canvas:#F6F7F5; --surface:#FFFFFF; --ink:#16201D; --ink-muted:#5A6663;
  --hairline:#E3E7E3; --field:#EFF2EE;

  /* —— Brand: saffron = "act here now" (CTA / in-progress / needs-payment) —— */
  --saffron:#E8801A; --saffron-700:#B7610F; --saffron-50:#FCEFD9;

  /* —— Signal layer: one color per station, in routing order —— */
  --st-vitals:#4F5E7D; --st-doctor:#157A42; --st-blood:#C8323B;
  --st-ultra:#2563B0;  --st-xray:#6D4AA8;   --st-ekg:#0B7E7C; --st-shots:#BC3F84;

  /* —— Status —— */
  --s-queued:#6B7572; --s-active:#E8801A; --s-done:#5A6663;
  --s-error:#C8323B;  --s-ok:#157A42;

  /* —— Form —— */
  --r-sm:6px; --r-md:10px; --r-card:14px; --r-pill:999px;
  --e1:0 1px 2px rgba(20,32,29,.06); --e2:0 6px 20px rgba(20,32,29,.09);

  font-family:'Hanken Grotesk',system-ui,sans-serif; color:var(--ink);
}
.ds * { box-sizing:border-box; }
.ds .ds-grid { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; margin:16px 0 8px; }
.ds .ds-mono { font-family:'Spline Sans Mono',ui-monospace,monospace; }
.ds .ds-disp { font-family:'Bricolage Grotesque',system-ui,sans-serif; }
.ds .ds-eyebrow { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-muted); }

/* swatches */
.ds .ds-swatch { display:flex; flex-direction:column; gap:4px; width:118px; }
.ds .ds-chip { height:54px; border-radius:var(--r-sm); box-shadow:var(--e1); border:1px solid rgba(20,32,29,.06); }
.ds .ds-chip-name { font-size:12.5px; font-weight:600; }
.ds .ds-chip-hex { font-family:'Spline Sans Mono',monospace; font-size:11px; color:var(--ink-muted); }

/* care-spine band */
.ds .ds-spine { display:flex; flex-direction:column; border-radius:6px; overflow:hidden; box-shadow:var(--e1); }
.ds .ds-band { display:flex; align-items:center; gap:7px; padding:0 9px; height:34px; color:#fff; }
.ds .ds-band .num { font-family:'Spline Sans Mono',monospace; font-size:10px; opacity:.8; width:12px; }
.ds .ds-band .gly { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:15px; width:15px; text-align:center; }
.ds .ds-band .lbl { font-size:12.5px; font-weight:600; }
.ds .ds-band .box { margin-left:auto; width:16px; height:16px; border-radius:4px;
  border:1.5px solid rgba(255,255,255,.85); display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:700; line-height:1; }
.ds .ds-band.done { opacity:.5; }
.ds .ds-band.done .box { background:#fff; color:var(--ink); border-color:#fff; }
.ds .ds-band.next { box-shadow:inset 4px 0 0 0 var(--saffron); }

/* badge */
.ds .ds-badge { width:340px; background:var(--surface); border:1px solid var(--hairline);
  border-radius:8px; box-shadow:var(--e2); display:flex; overflow:hidden; }
.ds .ds-badge .ds-spine { border-radius:0; box-shadow:none; }
.ds .ds-badge .ds-band { height:38px; }
.ds .ds-badge-body { flex:1; padding:12px 14px; min-width:0; }
.ds .ds-badge-top { display:flex; gap:12px; }
.ds .ds-qr { width:62px; height:62px; flex:none; border-radius:6px;
  background:
    linear-gradient(45deg,var(--ink) 25%,transparent 0) 0 0/12px 12px,
    linear-gradient(-45deg,var(--ink) 25%,transparent 0) 0 6px/12px 12px,
    var(--surface);
  border:2px solid var(--ink); display:flex; align-items:flex-end; justify-content:flex-end; }
.ds .ds-name { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:21px; line-height:1.05; }
.ds .ds-id { font-family:'Spline Sans Mono',monospace; font-size:13px; color:var(--ink-muted); margin-top:3px; letter-spacing:.02em; }
.ds .ds-check { margin-top:10px; border-top:1px solid var(--hairline); padding-top:8px; display:flex; flex-direction:column; gap:5px; }
.ds .ds-check div { font-size:13px; display:flex; align-items:center; gap:7px; }
.ds .ds-tick { color:var(--s-ok); font-weight:700; }

/* dots */
.ds .ds-dot { width:26px; height:26px; border-radius:50%; color:#fff; display:inline-flex;
  align-items:center; justify-content:center; font-family:'Bricolage Grotesque',sans-serif;
  font-weight:700; font-size:13px; box-shadow:var(--e1); }
.ds .ds-dot.ghost { background:transparent!important; color:var(--ink-muted); border:1.5px dashed var(--hairline); box-shadow:none; }

/* station queue card */
.ds .ds-card { width:300px; background:var(--surface); border:1px solid var(--hairline);
  border-radius:var(--r-card); box-shadow:var(--e1); overflow:hidden; }
.ds .ds-card-head { display:flex; align-items:center; gap:9px; padding:11px 14px; color:#fff; }
.ds .ds-card-head .ds-disp { font-weight:700; font-size:16px; }
.ds .ds-card-head .count { margin-left:auto; font-family:'Spline Sans Mono',monospace; font-size:22px; font-weight:600; }
.ds .ds-row { display:flex; align-items:center; gap:11px; padding:12px 14px; border-top:1px solid var(--hairline); }
.ds .ds-row .who { min-width:0; }
.ds .ds-row .who .nm { font-weight:600; font-size:15px; }
.ds .ds-row .who .id { font-family:'Spline Sans Mono',monospace; font-size:11.5px; color:var(--ink-muted); }
.ds .ds-pill { margin-left:auto; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
  padding:5px 10px; border-radius:var(--r-pill); white-space:nowrap; }
.ds .ds-pill.queued { background:#EEF0EE; color:var(--s-queued); }
.ds .ds-pill.active { background:var(--saffron-50); color:var(--saffron-700); }
.ds .ds-pill.done   { background:#EEF0EE; color:var(--s-done); }

/* buttons + field */
.ds .ds-btn { min-height:48px; padding:0 22px; border-radius:var(--r-md); border:none; cursor:pointer;
  font-family:'Hanken Grotesk',sans-serif; font-weight:700; font-size:16px; display:inline-flex; align-items:center; gap:8px; }
.ds .ds-btn.primary { background:var(--saffron-700); color:#fff; box-shadow:var(--e1); }
.ds .ds-btn.ghost { background:var(--surface); color:var(--ink); border:1.5px solid var(--hairline); }
.ds .ds-field { width:280px; }
.ds .ds-field label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
.ds .ds-input { width:100%; min-height:48px; background:var(--field); border:1.5px solid var(--hairline);
  border-radius:var(--r-md); padding:0 14px; font-size:16px; font-family:'Hanken Grotesk',sans-serif; color:var(--ink); }
.ds .ds-input::placeholder { color:#9AA3A0; }

/* alert banner (needs payment) */
.ds .ds-alert { display:flex; align-items:center; gap:11px; width:340px; background:var(--saffron-50);
  border:1.5px solid var(--saffron); border-radius:var(--r-md); padding:12px 14px; }
.ds .ds-alert .ic { width:30px; height:30px; flex:none; border-radius:50%; background:var(--saffron);
  color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; }
.ds .ds-alert .tx { font-size:14px; } .ds .ds-alert .tx b { color:var(--saffron-700); }

/* dashboard tile */
.ds .ds-tile { width:150px; background:var(--surface); border:1px solid var(--hairline);
  border-radius:var(--r-card); box-shadow:var(--e1); padding:13px 15px; }
.ds .ds-tile .cap { font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-muted); }
.ds .ds-tile .big { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:38px; line-height:1; margin-top:6px; }
.ds .ds-tile .big.warn { color:var(--saffron-700); }

/* A4 progress report sheet */
.ds .ds-sheet { width:430px; max-width:100%; background:var(--surface); border:1px solid var(--hairline);
  border-radius:8px; box-shadow:var(--e2); display:flex; overflow:hidden; }
.ds .ds-sheet .ds-spine { border-radius:0; box-shadow:none; }
.ds .ds-sheet .ds-band { height:44px; }
.ds .ds-sheet-body { flex:1; padding:14px 16px; min-width:0; }
.ds .ds-sheet-head { display:flex; gap:12px; align-items:flex-start; }
.ds .ds-paid { font-size:12.5px; color:var(--ink-muted); margin-top:9px; padding-top:9px; border-top:1px solid var(--hairline); }
.ds .ds-paid b { color:var(--ink); }
.ds .ds-notes-l { margin-top:11px; }
.ds .ds-line { height:20px; border-bottom:1px solid var(--hairline); }
.ds .ds-addserv { margin-top:11px; border-top:1px dashed var(--hairline); padding-top:9px;
  font-size:12.5px; display:flex; align-items:center; gap:8px; color:var(--ink-muted); }
.ds .ds-cbox { width:14px; height:14px; border:1.5px solid var(--ink-muted); border-radius:3px; flex:none; }
.ds .ds-foot { margin-top:11px; background:var(--saffron-50); border-radius:var(--r-sm);
  padding:9px 11px; font-size:12px; line-height:1.4; display:flex; gap:10px; align-items:center; }
.ds .ds-foot .ds-mono { color:var(--saffron-700); font-weight:600; }
.ds .ds-qr-sm { width:44px; height:44px; flex:none; border-radius:5px;
  background:
    linear-gradient(45deg,var(--ink) 25%,transparent 0) 0 0/9px 9px,
    linear-gradient(-45deg,var(--ink) 25%,transparent 0) 0 4.5px/9px 9px,
    var(--surface);
  border:1.5px solid var(--ink); }

/* "Who you saw today" — public camp page */
.ds .ds-hero { max-width:560px; }
.ds .ds-hero h3 { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:30px;
  line-height:1.08; margin:6px 0 8px; color:var(--ink); }
.ds .ds-hero p { font-size:15px; line-height:1.5; color:var(--ink-muted); margin:0; }
.ds .ds-hero b { color:var(--ink); }
.ds .ds-staff { width:296px; background:var(--surface); border:1px solid var(--hairline);
  border-radius:var(--r-card); box-shadow:var(--e1); padding:16px; }
.ds .ds-staff .top { display:flex; gap:12px; align-items:center; }
.ds .ds-photo { width:54px; height:54px; border-radius:50%; background:var(--field); flex:none;
  display:flex; align-items:center; justify-content:center; font-family:'Bricolage Grotesque',sans-serif;
  font-weight:700; font-size:18px; color:var(--ink-muted); }
.ds .ds-staff .nm { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:18px; line-height:1.1; }
.ds .ds-staff .role { font-size:13px; color:var(--ink-muted); margin-top:2px; }
.ds .ds-tag { display:inline-flex; align-items:center; gap:6px; margin-top:10px;
  font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
  background:#EEF0EE; color:var(--ink); padding:4px 10px 4px 8px; border-radius:var(--r-pill); }
.ds .ds-tag .d { width:9px; height:9px; border-radius:50%; }
.ds .ds-bio { font-size:13px; line-height:1.5; margin-top:11px; }
.ds .ds-stat { margin-top:11px; padding-top:10px; border-top:1px solid var(--hairline);
  display:flex; justify-content:space-between; align-items:baseline; font-size:12.5px; color:var(--ink-muted); }
.ds .ds-stat b { font-family:'Spline Sans Mono',monospace; font-size:17px; color:var(--ink); }
.ds .ds-fb { width:340px; background:var(--surface); border:1px solid var(--hairline);
  border-radius:var(--r-card); box-shadow:var(--e1); padding:16px; }
.ds .ds-fb h4 { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:18px; margin:0; }
.ds .ds-stars { font-size:26px; letter-spacing:3px; color:var(--saffron); margin:8px 0 2px; }
.ds .ds-stars .off { color:var(--hairline); }
.ds .ds-fb .note { width:100%; min-height:54px; background:var(--field); border:1.5px solid var(--hairline);
  border-radius:var(--r-md); padding:10px 12px; font-size:14px; font-family:'Hanken Grotesk',sans-serif;
  color:var(--ink-muted); margin-top:8px; }
.ds .ds-social { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.ds .ds-soc { display:inline-flex; align-items:center; gap:7px; min-height:40px; padding:0 14px;
  border-radius:var(--r-pill); border:1.5px solid var(--hairline); background:var(--surface);
  font-size:13px; font-weight:600; color:var(--ink); }
.ds .ds-soc .ic { width:18px; height:18px; border-radius:4px; display:flex; align-items:center;
  justify-content:center; color:#fff; font-weight:700; font-size:12px; }

/* type specimens */
.ds .ds-type div { margin:2px 0; }

@media (prefers-reduced-motion:no-preference){
  .ds .ds-pill.active{ animation:dspulse 2.2s ease-in-out infinite; }
  @keyframes dspulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(232,128,26,0);} 50%{ box-shadow:0 0 0 4px rgba(232,128,26,.15);} }
}
</style>

## Direction

The platform coordinates a crowded, half-day medical camp — 300–500 people moving through stations while volunteers route them by eye. The design has one job: **let a volunteer know, at a glance, what a person needs and where they go next** — on a 6" phone in a bright tent, or on the A4 progress report the patient carries from station to station and takes home.

So the system is built in two layers that never compete:

- **Chrome recedes.** Backgrounds, text, and structure are a quiet near-white and deep ink. No color is spent on decoration.
- **Signal carries meaning.** Every saturated color means something specific — a station, a status, or an action. If it's colored, it's actionable.

### Signature — the Care Spine

The element the whole system is remembered by is a vertical stack of color bands, one per station a person is enrolled in, **in the order they'll walk them**. It runs down the left margin of the patient's A4 progress report — the one sheet they carry from station to station and take home — and recurs as the wayfinding device on station cards and the dashboard.

Each band is **redundantly encoded** — color **and** a letter glyph **and** a step number — so it survives colorblindness and any grayscale fallback print. The numbers are not decoration: the camp flow genuinely is a sequence (`Vitals → Doctor → labs`), so the order carries real information.

<div class="ds">
<div class="ds-grid">
  <div class="ds-spine" style="width:150px">
    <div class="ds-band" style="background:var(--st-vitals)"><span class="num">1</span><span class="gly">V</span><span class="lbl">Vitals</span></div>
    <div class="ds-band" style="background:var(--st-doctor)"><span class="num">2</span><span class="gly">D</span><span class="lbl">Doctor</span></div>
    <div class="ds-band" style="background:var(--st-blood)"><span class="num">3</span><span class="gly">B</span><span class="lbl">Blood draw</span></div>
    <div class="ds-band" style="background:var(--st-ultra)"><span class="num">4</span><span class="gly">U</span><span class="lbl">Ultrasound</span></div>
  </div>
  <div style="align-self:center;max-width:330px">
    <div class="ds-eyebrow">Reads as</div>
    <p style="margin:6px 0 0;font-size:14px;line-height:1.5">“This patient does vitals, sees a doctor, then has bloodwork and an ultrasound — in that order.” A volunteer points to the next un-done band.</p>
  </div>
</div>
</div>

### Tracking "done"

The **system is the source of truth.** A scan at a station flips that `StationVisit` from `queued → in-progress → done` (with a `done_at` timestamp), and the patient is auto-routed to the topmost remaining station. Dashboard and on-screen views update live.

The printed rail can't change after it's printed, so it mirrors that state with a low-tech mark: **each band has a check box**, and the **doctor or tech pen-checks it once they're done seeing the patient.** The **next station is always the topmost un-checked band** — a saffron leading edge marks it on screen. Done bands recede; the path forward stays loud.

A mid-visit add-on (doctor recommends a service not pre-paid) is captured on the sheet's **Add service** line and as a new `StationVisit` digitally — the patient is flagged *Needs payment*, routed to the desk, and on to the new station. No reprint of the sheet is needed.

<div class="ds"><div class="ds-grid">
  <div class="ds-spine" style="width:172px">
    <div class="ds-band done" style="background:var(--st-vitals)"><span class="num">1</span><span class="gly">V</span><span class="lbl">Vitals</span><span class="box">✓</span></div>
    <div class="ds-band done" style="background:var(--st-doctor)"><span class="num">2</span><span class="gly">D</span><span class="lbl">Doctor</span><span class="box">✓</span></div>
    <div class="ds-band next" style="background:var(--st-blood)"><span class="num">3</span><span class="gly">B</span><span class="lbl">Blood draw</span><span class="box"></span></div>
    <div class="ds-band" style="background:var(--st-ultra)"><span class="num">4</span><span class="gly">U</span><span class="lbl">Ultrasound</span><span class="box"></span></div>
  </div>
  <div style="align-self:center;max-width:300px;font-size:13.5px;line-height:1.55;color:var(--ink-muted)">
    <span class="ds-eyebrow" style="color:var(--ink)">Reads as</span><br>
    Vitals and Doctor are <b>done</b> (checked, dimmed). <b>Blood draw is next</b> — the saffron edge. Ultrasound still waits. No screen required.
  </div>
</div></div>

---

## Color tokens

Copy these as CSS custom properties — they are the single source of truth for the build.

### Chrome — neutral, recedes

<div class="ds"><div class="ds-grid">
  <div class="ds-swatch"><div class="ds-chip" style="background:#F6F7F5"></div><span class="ds-chip-name">Canvas</span><span class="ds-chip-hex">#F6F7F5</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#FFFFFF"></div><span class="ds-chip-name">Surface</span><span class="ds-chip-hex">#FFFFFF</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#16201D"></div><span class="ds-chip-name">Ink</span><span class="ds-chip-hex">#16201D</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#5A6663"></div><span class="ds-chip-name">Ink muted</span><span class="ds-chip-hex">#5A6663</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#E3E7E3"></div><span class="ds-chip-name">Hairline</span><span class="ds-chip-hex">#E3E7E3</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#EFF2EE"></div><span class="ds-chip-name">Field</span><span class="ds-chip-hex">#EFF2EE</span></div>
</div></div>

### Brand — saffron means "act here now"

One accent, used for the primary action on a screen, the in-progress state, and the needs-payment alert. Culturally warm for the dcica community, and deliberately outside every clinical station hue. Text-bearing surfaces use **Saffron 700** for AA contrast on white; the bright **Saffron** is for fills, indicators, and the spine accent.

<div class="ds"><div class="ds-grid">
  <div class="ds-swatch"><div class="ds-chip" style="background:#E8801A"></div><span class="ds-chip-name">Saffron</span><span class="ds-chip-hex">#E8801A</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#B7610F"></div><span class="ds-chip-name">Saffron 700</span><span class="ds-chip-hex">#B7610F</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#FCEFD9"></div><span class="ds-chip-name">Saffron 50</span><span class="ds-chip-hex">#FCEFD9</span></div>
</div></div>

### Signal — one color per station

Assigned in routing order. The doc fixes three (red = blood draw, blue = ultrasound, green = physician); the rest extend that logic. Each is paired with a fixed **letter glyph** for grayscale and colorblind safety.

<div class="ds"><div class="ds-grid">
  <div class="ds-swatch"><div class="ds-chip" style="background:#4F5E7D"></div><span class="ds-chip-name">Vitals · V</span><span class="ds-chip-hex">#4F5E7D</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#157A42"></div><span class="ds-chip-name">Physician · D</span><span class="ds-chip-hex">#157A42</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#C8323B"></div><span class="ds-chip-name">Blood draw · B</span><span class="ds-chip-hex">#C8323B</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#2563B0"></div><span class="ds-chip-name">Ultrasound · U</span><span class="ds-chip-hex">#2563B0</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#6D4AA8"></div><span class="ds-chip-name">X-Ray · X</span><span class="ds-chip-hex">#6D4AA8</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#0B7E7C"></div><span class="ds-chip-name">EKG · E</span><span class="ds-chip-hex">#0B7E7C</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#BC3F84"></div><span class="ds-chip-name">Shots · S</span><span class="ds-chip-hex">#BC3F84</span></div>
</div></div>

### Status — and the red rule

Crimson is overloaded by nature: it's both the blood-draw station and the universal error color. The rule that keeps them apart: **crimson is only ever a station dot (a circle with a letter) or a hard error/blocked state.** Anything that means "a human needs to do something" — including *needs payment* — is **saffron**. Dots are circles; alerts are banners. Different shape, no confusion.

<div class="ds"><div class="ds-grid">
  <div class="ds-swatch"><div class="ds-chip" style="background:#6B7572"></div><span class="ds-chip-name">Queued</span><span class="ds-chip-hex">#6B7572</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#E8801A"></div><span class="ds-chip-name">In progress</span><span class="ds-chip-hex">#E8801A</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#5A6663"></div><span class="ds-chip-name">Done (recedes)</span><span class="ds-chip-hex">#5A6663</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#157A42"></div><span class="ds-chip-name">Paid / OK</span><span class="ds-chip-hex">#157A42</span></div>
  <div class="ds-swatch"><div class="ds-chip" style="background:#C8323B"></div><span class="ds-chip-name">Error / blocked</span><span class="ds-chip-hex">#C8323B</span></div>
</div></div>

---

## Typography

A deliberate trio. The display face carries personality and is used with restraint; the body face is tuned for small phone sizes; the mono is reserved for things that genuinely *are* codes and figures — camp IDs, prices, queue counts, timestamps.

| Role | Typeface | Use |
|---|---|---|
| **Display** | Bricolage Grotesque | Patient names, page titles, dashboard numbers, station headers |
| **Body** | Hanken Grotesk | All UI text, labels, paragraphs, buttons |
| **Mono** | Spline Sans Mono | Camp IDs, prices, queue counts, times — anything coded or tabular |

<div class="ds ds-type" style="margin-top:14px">
  <div class="ds-eyebrow">Display · Bricolage Grotesque</div>
  <div class="ds-disp" style="font-weight:700;font-size:40px;line-height:1.05">Priya Sharma</div>
  <div class="ds-disp" style="font-weight:600;font-size:24px">Ultrasound queue</div>
  <div class="ds-eyebrow" style="margin-top:14px">Body · Hanken Grotesk</div>
  <div style="font-size:16px;max-width:440px;line-height:1.5">Scan the patient's badge to mark them in progress. When the service is done, mark Done and the system routes them to their next station.</div>
  <div style="font-size:14px;font-weight:600;margin-top:4px">Secondary label · 14px / 600</div>
  <div class="ds-eyebrow" style="margin-top:14px">Mono · Spline Sans Mono</div>
  <div class="ds-mono" style="font-size:18px">MC-2026W-0148 · $40.00 · 11:42</div>
</div>

### Type scale

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display-xl` | 40 / 44 | 700 | Dashboard hero figure |
| `display-l` | 28 / 32 | 700 | Page title, badge name |
| `heading` | 20 / 26 | 600 | Section / card header |
| `body` | 16 / 24 | 400 | Base — never below 16px on phone (prevents iOS zoom) |
| `small` | 14 / 20 | 500 | Secondary text |
| `eyebrow` | 11 / 16 | 600 | Uppercase label, +0.12em tracking |

---

## Components

### Progress report sheet — the signature artifact

One A4 sheet per patient: the **doctor's note-taking page** and the **patient's take-home record** in a single artifact. The **Care Spine** runs down the left margin as a routing rail; the QR header is the scan target; the body is the doctor's working space and what the patient walks out with.

The patient keeps it, so **dcica never holds the clinical advice** — the system stores only identity and paid services (camp-scoped, purged). The camp ID is also the **code the patient uses later to check lab status** in the patient portal.

<div class="ds"><div class="ds-grid">
  <div class="ds-sheet">
    <div class="ds-spine">
      <div class="ds-band done" style="background:var(--st-vitals)"><span class="num">1</span><span class="gly">V</span><span class="box">✓</span></div>
      <div class="ds-band done" style="background:var(--st-doctor)"><span class="num">2</span><span class="gly">D</span><span class="box">✓</span></div>
      <div class="ds-band next" style="background:var(--st-blood)"><span class="num">3</span><span class="gly">B</span><span class="box"></span></div>
      <div class="ds-band" style="background:var(--st-ultra)"><span class="num">4</span><span class="gly">U</span><span class="box"></span></div>
    </div>
    <div class="ds-sheet-body">
      <div class="ds-sheet-head">
        <div class="ds-qr"></div>
        <div style="min-width:0">
          <div class="ds-name">Priya Sharma</div>
          <div class="ds-id">MC-2026W-0148</div>
        </div>
      </div>
      <div class="ds-paid"><b>Paid:</b> Doctor consultation · Blood test · Ultrasound</div>
      <div class="ds-notes-l"><span class="ds-eyebrow">Doctor's notes &amp; advice</span></div>
      <div class="ds-line"></div><div class="ds-line"></div><div class="ds-line"></div>
      <div class="ds-addserv"><span class="ds-cbox"></span> Add service: __________________ → desk for payment</div>
      <div class="ds-foot">
        <div class="ds-qr-sm"></div>
        <div>Your camp page — <b>meet the doctors who volunteered</b> and check your lab status.<br>dcica.org/c/2026W · code <span class="ds-mono">MC-2026W-0148</span></div>
      </div>
    </div>
  </div>
  <div style="max-width:280px;font-size:13.5px;line-height:1.55;color:var(--ink-muted)">
    <span class="ds-eyebrow" style="color:var(--ink)">Anatomy</span><br>
    <b>Rail</b> — enrolled stations in routing order; doctor/tech pen-checks each when done.<br>
    <b>Header QR</b> — the <em>staff</em> scan target; ties to the camp-scoped record (purged after camp).<br>
    <b>Paid line</b> — plain-language confirmation of paid services.<br>
    <b>Notes</b> — the doctor's working space; goes home with the patient.<br>
    <b>Add service</b> — captures a mid-visit add-on into the <em>Needs payment</em> flow.<br>
    <b>Footer QR</b> — the <em>patient's</em> take-home link to the persistent camp page: meet the doctors + check lab status.
  </div>
</div></div>

**Production.** Print the full sheet on a **color laser (A4)** so the rail prints in color — and **pre-print the ~80% pre-registered patients the night before**, leaving only walk-ins to print live, so one printer keeps up. Where no color printer is available, the fallback is a pre-printed B&W sheet with the rail rendered in grayscale (letter + number + check still carry it). The **thermal label printer is reserved for lab/sample stickers**, below.

**Multi-page packets.** A patient seeing several specialists needs more note room than one page. Page 1 carries the rail, header, and footer; **continuation pages are consult-note pages**, stapled into one packet the patient carries and takes home. Pages are estimated from the number of consult-type services at print time (a doctor can request another at the desk). The rule that keeps a stray page findable: **every page runs a header of name + camp ID + "Page X of Y"** — identity only, never clinical content — and a specialty label in the station color.

<div class="ds"><div class="ds-grid">
  <div class="ds-sheet" style="width:360px">
    <div class="ds-sheet-body">
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--hairline);padding-bottom:8px">
        <span style="font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:16px">Priya Sharma</span>
        <span class="ds-mono" style="font-size:12px;color:var(--ink-muted)">Page 2 of 3 · MC-2026W-0148</span>
      </div>
      <div class="ds-notes-l"><span class="ds-tag" style="margin-top:0"><span class="d" style="background:var(--st-ekg)"></span> Cardiology consult</span></div>
      <div class="ds-line"></div><div class="ds-line"></div><div class="ds-line"></div><div class="ds-line"></div>
    </div>
  </div>
  <div style="max-width:280px;font-size:13.5px;line-height:1.55;color:var(--ink-muted)">
    <span class="ds-eyebrow" style="color:var(--ink)">Continuation page</span><br>
    No rail or QR — page 1 holds the wayfinding. Just the running header (so a detached page is identifiable) and note space, tagged to the consult.
  </div>
</div></div>

### Lab & sample stickers

Printed from the thermal label printer for patients with lab services — peeled and applied to the tube at the blood-draw station, so there's no handwriting on samples. Carries the station color, sample type, name, and camp ID. The camp ID ties the physical tube back to the digital record without storing any result.

<div class="ds"><div class="ds-grid">
  <div style="display:flex;width:240px;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;overflow:hidden;box-shadow:var(--e1)">
    <div style="width:8px;background:var(--st-blood)"></div>
    <div style="padding:9px 12px">
      <div style="font-weight:700;font-size:14px">Blood — Priya Sharma</div>
      <div class="ds-mono" style="font-size:12px;color:var(--ink-muted);margin-top:2px">MC-2026W-0148 · 2026-12-06</div>
    </div>
  </div>
</div></div>

### "Who you saw today" — the camp's public page

The take-home footer QR resolves here: a persistent, public page per camp that thanks the medical staff and lets patients look up the doctors they saw. It's the warm, editorial face of the system — same tokens, looser layout.

It's **staff data, not patient data**, so it lives on past the patient-record purge. Each doctor's "saw N patients" is an aggregate counter (incremented when a logged-in doctor marks a consult done — the integer is kept, never the patient link). Contact is **opt-in per staff**; default is "reach via dcica." The page is also the canonical link target for the [Social Media Pack](MedCamp-System-Overview) shout-outs.

<div class="ds">
<div class="ds-hero">
  <span class="ds-eyebrow" style="color:var(--saffron-700)">Thank you · dcica Winter Camp 2026</span>
  <h3>The doctors who showed up for our community</h3>
  <p>Together, <b>23 physicians and technicians</b> saw <b>412 patients</b> across 7 specialties in a single morning.</p>
</div>
<div class="ds-grid" style="margin-top:18px">
  <div class="ds-staff">
    <div class="top">
      <div class="ds-photo">AR</div>
      <div><div class="nm">Dr. Asha Rao</div><div class="role">MD · Internal Medicine</div></div>
    </div>
    <span class="ds-tag"><span class="d" style="background:var(--st-doctor)"></span> Physician</span>
    <div class="ds-bio">Two decades in community health; has volunteered at every dcica camp since 2019.</div>
    <div class="ds-stat"><span>Patients seen</span><b>86</b></div>
  </div>
  <div class="ds-staff">
    <div class="top">
      <div class="ds-photo">VM</div>
      <div><div class="nm">Dr. Vivek Menon</div><div class="role">MD · Radiology</div></div>
    </div>
    <span class="ds-tag"><span class="d" style="background:var(--st-ultra)"></span> Ultrasound</span>
    <div class="ds-bio">Reads bedside ultrasound for the camp's screening clinic. Reachable for follow-up via dcica.</div>
    <div class="ds-stat"><span>Patients seen</span><b>64</b></div>
  </div>
</div>
</div>

#### Feedback & reviews

The same page (and the post-camp thank-you email) invites a review. Two layers: a **quick private rating** the committee sees, and **outbound links** to post publicly. The rating + comment go to the committee — useful signal even from people who won't post in public. The social buttons are plain outbound links (no API): **Facebook** today, with room to add Instagram, X, or Google reviews later from a configurable list. A comment is published as a public testimonial only if the patient opts in.

<div class="ds"><div class="ds-grid">
  <div class="ds-fb">
    <h4>How was your visit?</h4>
    <div class="ds-stars">★★★★<span class="off">★</span></div>
    <div class="note">Anything you'd like us to know? (optional)</div>
    <div class="ds-social">
      <span class="ds-soc"><span class="ic" style="background:#1877F2">f</span> Review on Facebook</span>
      <span class="ds-soc" style="border-style:dashed;color:var(--ink-muted)">+ more soon</span>
    </div>
  </div>
  <div style="max-width:280px;font-size:13.5px;line-height:1.55;color:var(--ink-muted)">
    <span class="ds-eyebrow" style="color:var(--ink)">Notes</span><br>
    Rating + comment are <b>private to the committee</b> unless the patient opts in to a public testimonial.<br>
    Social links are configurable — add platforms over time; the dashed chip shows where they'll appear.
  </div>
</div></div>

### Service dots — the inline form of the spine

Where a full spine doesn't fit (lists, confirmation email, small labels), the same colors appear as letter dots. **Enrolled** dots are filled; **not enrolled** are dashed ghosts — so the row always shows the full menu, and absence is as readable as presence.

<div class="ds"><div class="ds-grid" style="align-items:center">
  <span class="ds-dot" style="background:var(--st-vitals)">V</span>
  <span class="ds-dot" style="background:var(--st-doctor)">D</span>
  <span class="ds-dot" style="background:var(--st-blood)">B</span>
  <span class="ds-dot ghost">U</span>
  <span class="ds-dot ghost">X</span>
  <span class="ds-dot ghost">E</span>
  <span class="ds-dot ghost">S</span>
</div></div>

### Station queue card — phone-first

Single column, 48px tap rows, one status verb per patient. The card header wears the station color so a volunteer always knows which queue they're holding. Done patients recede to muted; the active patient pulses saffron.

<div class="ds"><div class="ds-grid">
  <div class="ds-card">
    <div class="ds-card-head" style="background:var(--st-ultra)">
      <span class="gly ds-disp">U</span><span class="ds-disp">Ultrasound</span><span class="count">07</span>
    </div>
    <div class="ds-row">
      <span class="ds-dot" style="background:var(--st-ultra);width:30px;height:30px">U</span>
      <div class="who"><div class="nm">Priya Sharma</div><div class="id">MC-2026W-0148</div></div>
      <span class="ds-pill active">In progress</span>
    </div>
    <div class="ds-row">
      <span class="ds-dot" style="background:var(--st-ultra);width:30px;height:30px">U</span>
      <div class="who"><div class="nm">Anil Kumar</div><div class="id">MC-2026W-0151</div></div>
      <span class="ds-pill queued">Queued</span>
    </div>
    <div class="ds-row" style="opacity:.6">
      <span class="ds-dot" style="background:var(--s-done);width:30px;height:30px">U</span>
      <div class="who"><div class="nm">Meera Joshi</div><div class="id">MC-2026W-0144</div></div>
      <span class="ds-pill done">Done</span>
    </div>
  </div>
  <div style="max-width:300px;font-size:13.5px;line-height:1.55;color:var(--ink-muted)">
    <span class="ds-eyebrow" style="color:var(--ink)">Notes</span><br>
    Queue depth (mono, top-right) is the number that matters to the coordinator.<br>
    The volunteer touches a row to scan in / mark done — no menus.
  </div>
</div></div>

### Needs-payment alert

The one moment a station hands a patient back to the desk. Saffron, never crimson — this is an action, not an error.

<div class="ds"><div class="ds-grid">
  <div class="ds-alert">
    <span class="ic">!</span>
    <span class="tx"><b>Needs payment</b> — Anil Kumar added <b>X-Ray ($40)</b>. Escort to registration desk.</span>
  </div>
</div></div>

### Buttons & fields

Primary action is saffron and unmistakable; everything else is a quiet ghost. Inputs are 48px minimum with 16px text.

<div class="ds"><div class="ds-grid" style="align-items:flex-end">
  <button class="ds-btn primary">Mark done →</button>
  <button class="ds-btn ghost">Look up by name</button>
  <div class="ds-field">
    <label for="ds-phone">Phone number</label>
    <input id="ds-phone" class="ds-input" placeholder="(555) 012-3456" inputmode="tel">
  </div>
</div></div>

### Dashboard tiles

The coordinator's god-view. Numbers in display weight; a tile turns saffron only when it needs attention (a deepening queue, pending add-on payments).

<div class="ds"><div class="ds-grid">
  <div class="ds-tile"><div class="cap">Checked in</div><div class="big">312</div></div>
  <div class="ds-tile"><div class="cap">In service</div><div class="big">48</div></div>
  <div class="ds-tile"><div class="cap">Ultrasound queue</div><div class="big warn">15</div></div>
  <div class="ds-tile"><div class="cap">Needs payment</div><div class="big warn">3</div></div>
</div></div>

---

## Foundations

**Spacing** — 4px base: `4 · 8 · 12 · 16 · 24 · 32 · 48`. **Radius** — `sm 6 · md 10 · card 14 · pill 999`; the badge uses 8px to read as a printed label. **Elevation** — two levels only: `e1` hairline lift for cards, `e2` for the badge and floating alerts.

## Voice

Label things by what a volunteer controls. Active and literal: **Mark done**, not *Submit*. An action keeps its name through the flow — the button that says **Mark done** produces a row that reads **Done**. Errors say what happened and what to do (*"Minor has no signed waiver — contact the registrant"*), never apologize, never go vague.

## Accessibility & print

- **Color is never the only signal.** Every station carries a letter glyph; every status carries a word. The system is legible in grayscale (label printers) and for colorblind volunteers.
- **Contrast.** Body text on canvas clears AA; station fills clear AA-large with their white glyph. Saffron 700 is the text-bearing variant.
- **Touch.** 48px minimum targets, single-column on queue and scan views, 16px inputs (no iOS zoom). No horizontal scroll on a 6" phone.
- **Motion.** One ambient cue — the active-patient pulse — and it respects `prefers-reduced-motion`. Everything else is static.
- **Print.** The badge is designed mono-safe: spine bands and the QR survive a thermal label printer; the camp ID and checklist remain the source of truth if color is lost.

---

*This document is the canonical reference for the build. The CSS custom properties above drop directly into the Next.js app's global stylesheet.*
