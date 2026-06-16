/* ============================================================================
   MedCamp demo — interactivity
   Vanilla JS, no build. Each page calls its init function on DOMContentLoaded.
   ========================================================================== */

/* ---------- small helpers ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function money(n) { return '$' + n.toFixed(2); }

/* Reset link, present on every page. */
function wireReset() {
  $all('[data-reset]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    resetDemo();
    location.href = 'index.html';
  }));
}

/* Service dots — full station menu; enrolled filled, others dashed ghosts. */
function serviceDotsHTML(stationLetters) {
  const order = ['V', 'D', 'B', 'U', 'X', 'E', 'S'];
  return '<div class="dot-row">' + order.map(L => {
    const st = STATIONS[L];
    return stationLetters.includes(L)
      ? `<span class="ds-dot" style="background:${st.color}" title="${st.label}">${L}</span>`
      : `<span class="ds-dot ghost" title="${st.label}">${L}</span>`;
  }).join('') + '</div>';
}

/* Care Spine bands for a list of station letters. */
function spineHTML(stationLetters, opts = {}) {
  return '<div class="ds-spine">' + stationLetters.map((L, i) => {
    const st = STATIONS[L];
    const done = opts.doneCount && i < opts.doneCount;
    const next = opts.doneCount && i === opts.doneCount;
    const cls = `ds-band${done ? ' done' : ''}${next ? ' next' : ''}`;
    return `<div class="${cls}" style="background:${st.color}">
      <span class="num">${i + 1}</span><span class="gly">${L}</span>
      <span class="lbl">${st.label}</span>
      <span class="box">${done ? '✓' : ''}</span>
    </div>`;
  }).join('') + '</div>';
}

/* ============================================================================
   MODULE 1 — Registration
   ========================================================================== */
function initRegister() {
  const list = $('#attendees');
  const totalEl = $('#total');
  let attendees = [];
  let counter = 0;

  function blankAttendee(self = false) {
    return { key: ++counter, name: self ? ($('#regName').value || '') : '', age: '', address: '', services: [], waiver: false };
  }

  function add(self = false) { attendees.push(blankAttendee(self)); render(); }

  function remove(key) { attendees = attendees.filter(a => a.key !== key); render(); }

  function svcRow(a, svc) {
    const checked = a.services.includes(svc.id);
    const full = svc.cap !== null && svc.remaining <= 0;
    const low = svc.cap !== null && svc.remaining > 0 && svc.remaining <= 10;
    let capTxt = '';
    if (svc.disabled) capTxt = '<span class="cap">Coming soon</span>';
    else if (svc.cap === null) capTxt = '<span class="cap">No limit</span>';
    else if (full) capTxt = '<span class="cap full">Full — capacity reached</span>';
    else capTxt = `<span class="cap${low ? ' low' : ''}">${svc.remaining} of ${svc.cap} left</span>`;
    const disabled = svc.disabled || full;
    const dot = svc.station
      ? `<span class="ds-dot" style="background:${STATIONS[svc.station].color};width:30px;height:30px">${svc.station}</span>`
      : '<span class="ds-dot ghost" style="width:30px;height:30px">·</span>';
    return `<label class="svc${checked ? ' checked' : ''}${disabled ? ' full' : ''}">
      <input type="checkbox" data-key="${a.key}" data-svc="${svc.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      ${dot}
      <span class="meta"><span class="nm">${svc.name}</span> ${capTxt}</span>
      <span class="price">${svc.priceLabel}${svc.est ? ' (est.)' : ''}</span>
    </label>`;
  }

  function card(a, i) {
    const isMinor = a.age !== '' && Number(a.age) < 18;
    const who = a.name.trim() || 'this minor';
    const waiverLabel = isMinor
      ? `<span class="minor-note">Parent / Guardian signature for ${who}</span> — I confirm I am the parent or guardian and sign this minor's waiver.`
      : 'I acknowledge and sign the camp liability waiver.';
    return `<div class="attendee" data-key="${a.key}">
      <div class="attendee-head">
        <span class="idx">${i + 1}</span>
        <span class="ttl">${a.name.trim() || 'Attendee ' + (i + 1)}</span>
        <button type="button" class="rm" data-rm="${a.key}">Remove</button>
      </div>
      <div class="field-2">
        <div class="ds-field"><label>Full name</label>
          <input class="ds-input" data-key="${a.key}" data-f="name" value="${a.name}" placeholder="e.g. Priya Sharma"></div>
        <div class="ds-field"><label>Age</label>
          <input class="ds-input" data-key="${a.key}" data-f="age" value="${a.age}" inputmode="numeric" placeholder="e.g. 34"></div>
      </div>
      <div class="ds-field"><label>Mailing address (for lab results)</label>
        <input class="ds-input" data-key="${a.key}" data-f="address" value="${a.address}" placeholder="Street, City, ST ZIP"></div>
      <div class="ds-eyebrow" style="margin-top:6px">Select services</div>
      <div class="svc-list">${SERVICES.map(s => svcRow(a, s)).join('')}</div>
      <label class="waiver">
        <input type="checkbox" data-key="${a.key}" data-f="waiver" ${a.waiver ? 'checked' : ''}>
        <span>${waiverLabel}</span>
      </label>
    </div>`;
  }

  function computeTotal() {
    let t = 0;
    attendees.forEach(a => a.services.forEach(id => {
      const s = SERVICES.find(x => x.id === id);
      if (s && s.price) t += s.price;
    }));
    return t;
  }

  function render() {
    list.innerHTML = attendees.map(card).join('') ||
      '<p class="muted">No attendees yet. Add the people you’re registering.</p>';
    const t = computeTotal();
    totalEl.textContent = money(t);
    $('#payBtn').disabled = attendees.length === 0;
    $('#estNote').style.display = attendees.some(a => a.services.includes('blood')) ? 'block' : 'none';
  }

  /* event delegation */
  list.addEventListener('input', e => {
    const key = Number(e.target.dataset.key);
    const a = attendees.find(x => x.key === key);
    if (!a) return;
    const f = e.target.dataset.f;
    if (f === 'name') { a.name = e.target.value; $(`.attendee[data-key="${key}"] .ttl`).textContent = a.name.trim() || 'Attendee'; }
    else if (f === 'age') { a.age = e.target.value; render(); }            // re-render: minor label may change
    else if (f === 'address') { a.address = e.target.value; }
    else if (f === 'waiver') { a.waiver = e.target.checked; }
    else if (e.target.dataset.svc) {
      const id = e.target.dataset.svc;
      if (e.target.checked) { if (!a.services.includes(id)) a.services.push(id); }
      else a.services = a.services.filter(x => x !== id);
      render();
    }
  });
  list.addEventListener('click', e => {
    if (e.target.dataset.rm) remove(Number(e.target.dataset.rm));
  });

  $('#addAttendee').addEventListener('click', () => add(false));
  $('#addSelf').addEventListener('click', () => add(true));

  $('#fillSample')?.addEventListener('click', () => {
    $('#regName').value = 'Priya Sharma'; $('#regEmail').value = 'priya@example.com';
    $('#regPhone').value = '(555) 012-3456'; $('#regAddress').value = '12 Maple St, Edison, NJ 08820';
    $('#consent').checked = true;
    attendees = [
      { key: ++counter, name: 'Priya Sharma', age: '34', address: '', services: ['consult1', 'ultra'], waiver: true },
      { key: ++counter, name: 'Aarav Sharma', age: '10', address: '', services: ['consult1', 'blood'], waiver: true },
    ];
    render();
  });

  $('#payBtn').addEventListener('click', () => {
    // light validation for the demo
    if (attendees.length === 0) return;
    const bad = attendees.find(a => !a.name.trim() || !a.waiver);
    if (bad) { alert('Each attendee needs a name and a signed waiver before payment.'); return; }
    if (!$('#consent')) { /* no-op */ }

    const reg = {
      registrant: {
        name: $('#regName').value, email: $('#regEmail').value,
        phone: $('#regPhone').value, address: $('#regAddress').value,
      },
      marketingConsent: $('#consent').checked,
      total: computeTotal(),
      camp: CAMP,
      attendees: attendees.map(a => {
        const stations = spineFor(a.services);
        const names = a.services.length
          ? a.services.map(id => SERVICES.find(s => s.id === id).name)
          : ['First consultation'];
        return {
          campId: nextCampId(), name: a.name.trim(), age: a.age,
          isMinor: a.age !== '' && Number(a.age) < 18,
          services: a.services, stations, paidLabels: names,
        };
      }),
    };
    saveRegistration(reg);
    location.href = 'confirmation.html';
  });

  // start with one attendee row
  add(false);
}

/* ============================================================================
   MODULE 2 — Confirmation (progress report sheet per attendee)
   ========================================================================== */
function initConfirmation() {
  const reg = loadRegistration();
  const root = $('#confirm');
  if (!reg || !reg.attendees || !reg.attendees.length) {
    root.innerHTML = `<div class="card"><p>No registration found for this demo session.</p>
      <a class="ds-btn primary" href="register.html">Start a registration</a></div>`;
    return;
  }
  $('#regSummary').innerHTML =
    `Confirmation sent to <b>${reg.registrant.email || reg.registrant.name || 'the registrant'}</b> ·
     <span class="ds-mono">${reg.attendees.length}</span> attendee(s) ·
     total paid <span class="ds-mono">${money(reg.total)}</span>`;

  root.innerHTML = reg.attendees.map(a => `
    <div style="margin-bottom:22px">
      <div class="ds-sheet">
        ${spineHTML(a.stations)}
        <div class="ds-sheet-body">
          <div class="ds-sheet-head">
            <div class="ds-qr"></div>
            <div style="min-width:0">
              <div class="ds-name">${a.name}</div>
              <div class="ds-id">${a.campId}</div>
            </div>
          </div>
          <div class="ds-paid"><b>Paid:</b> ${a.paidLabels.join(' · ')}</div>
          <div class="ds-notes-l"><span class="ds-eyebrow">Doctor's notes &amp; advice</span></div>
          <div class="ds-line"></div><div class="ds-line"></div><div class="ds-line"></div>
          <div class="ds-addserv"><span class="ds-cbox"></span> Add service: __________________ → desk for payment</div>
          <div class="ds-foot">
            <div class="ds-qr-sm"></div>
            <div>Your camp page — <b>meet the doctors who volunteered</b> and check your lab status.<br>
              dcica.org/c/${reg.camp.id} · code <span class="ds-mono">${a.campId}</span></div>
          </div>
        </div>
      </div>
      <div style="margin-top:8px">${serviceDotsHTML(a.stations)}</div>
    </div>`).join('');
}

/* ============================================================================
   MODULE 3 — Check-In gate
   ========================================================================== */
function initCheckin() {
  const reg = loadRegistration();
  const out = $('#checkinResult');

  $('#lookupBtn').addEventListener('click', () => {
    const q = $('#lookup').value.trim().toLowerCase();
    if (!q) { out.innerHTML = '<p class="muted">Enter a confirmation code or name.</p>'; return; }
    let match = null;
    if (reg && reg.attendees) {
      match = reg.attendees.find(a =>
        a.campId.toLowerCase() === q || a.name.toLowerCase().includes(q));
    }
    if (!match) {
      out.innerHTML = `<div class="card"><p class="muted">No attendee matched
        “${$('#lookup').value}”. Register first in this demo (the Registration screen),
        then look them up here by name or camp ID.</p></div>`;
      return;
    }
    if (match.isMinor) {
      out.innerHTML = `<div class="ds-error"><span class="ic">✕</span>
        <span class="tx"><b>Check-in blocked</b> — ${match.name} is a minor and has no signed
        parent/guardian waiver on file. Contact the registrant.</span></div>
        <p class="muted" style="margin-top:10px">(In the live system a minor with a signed guardian waiver
        passes; this demo treats minors as the blocked case to show the rule.)</p>`;
      return;
    }
    out.innerHTML = `<div class="card">
      <div class="ds-sheet-head"><div class="ds-qr"></div>
        <div><div class="ds-name" style="font-size:18px">${match.name}</div>
          <div class="ds-id">${match.campId}</div></div></div>
      <ul class="checks">
        <li><span class="tick">✓</span> Registered</li>
        <li><span class="tick">✓</span> Paid</li>
        <li><span class="tick">✓</span> Waiver signed</li>
      </ul>
      <div style="margin:12px 0">${serviceDotsHTML(match.stations)}</div>
      <button class="ds-btn primary block" id="printBtn">Print progress sheet →</button>
      <p id="assigned" class="muted" style="display:none;margin-top:10px"></p>
    </div>`;
    $('#printBtn').addEventListener('click', () => {
      const p = $('#assigned');
      p.style.display = 'block';
      p.innerHTML = `Progress sheet printed. <b>Assigned to first station: Vitals.</b>`;
    });
  });
}

/* ============================================================================
   MODULE 4 — Station queue (Ultrasound example)
   ========================================================================== */
function initStation() {
  const STATES = ['queued', 'active', 'done'];
  const LABELS = { queued: 'Queued', active: 'In progress', done: 'Done' };
  let rows = SAMPLE_QUEUE.map(r => ({ ...r }));
  const st = STATIONS.U;
  const card = $('#queueCard');

  function depth() { return rows.filter(r => r.state !== 'done').length; }

  function render() {
    card.innerHTML = `
      <div class="ds-card-head" style="background:${st.color}">
        <span class="gly">${st.letter}</span><span class="ds-disp">${st.label}</span>
        <span class="count">${String(depth()).padStart(2, '0')}</span>
      </div>
      ${rows.map((r, i) => `
        <button class="ds-row" data-i="${i}" style="${r.state === 'done' ? 'opacity:.6' : ''}">
          <span class="ds-dot" style="background:${r.state === 'done' ? 'var(--s-done)' : st.color};width:30px;height:30px">${st.letter}</span>
          <span class="who"><span class="nm">${r.name}</span><span class="id">${r.id}</span></span>
          <span class="ds-pill ${r.state}">${LABELS[r.state]}</span>
        </button>`).join('')}`;
    $all('.ds-row', card).forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      const cur = STATES.indexOf(rows[i].state);
      rows[i].state = STATES[(cur + 1) % STATES.length];
      render();
    }));
  }
  render();

  $('#addServiceBtn').addEventListener('click', () => {
    $('#payAlert').innerHTML = `<div class="ds-alert"><span class="ic">!</span>
      <span class="tx"><b>Needs payment</b> — Anil Kumar added <b>X-Ray ($40)</b>.
      Escort to registration desk.</span></div>`;
  });
}

/* ============================================================================
   MODULE 5 — Coordinator dashboard
   ========================================================================== */
function initDashboard() {
  let walkinOpen = DASHBOARD.walkinOpen;

  function render() {
    $('#tiles').innerHTML = `
      <div class="ds-tile"><div class="cap">Checked in</div><div class="big">${DASHBOARD.checkedIn}</div></div>
      <div class="ds-tile"><div class="cap">In service</div><div class="big">${DASHBOARD.inService}</div></div>
      <div class="ds-tile"><div class="cap">Ultrasound queue</div><div class="big warn">15</div></div>
      <div class="ds-tile"><div class="cap">Needs payment</div><div class="big warn">${DASHBOARD.needsPayment}</div></div>`;

    $('#queues').innerHTML = DASHBOARD.queues.map(q => {
      const s = STATIONS[q.station];
      const warn = q.depth >= 12;
      return `<div class="ds-row" style="cursor:default;border-top:1px solid var(--hairline)">
        <span class="ds-dot" style="background:${s.color};width:30px;height:30px">${s.letter}</span>
        <span class="who"><span class="nm">${s.label}</span></span>
        <span class="ds-pill ${warn ? 'active' : 'queued'}" style="font-family:'Spline Sans Mono',monospace">${q.depth} queued</span>
      </div>`;
    }).join('');

    $('#walkinState').textContent = walkinOpen ? 'OPEN' : 'On hold';
    $('#walkinBtn').textContent = walkinOpen ? 'Hold walk-in registration' : 'Open walk-in registration';
    $('#walkinBtn').className = walkinOpen ? 'ds-btn ghost' : 'ds-btn primary';
  }
  $('#walkinBtn')?.addEventListener('click', () => { walkinOpen = !walkinOpen; render(); });
  render();
}

/* ============================================================================
   VOLUNTEER — signup
   ========================================================================== */
function initVolunteer() {
  const rolesEl = $('#roles');
  let band = '';
  let selected = new Set();

  function eligible(role) { return band === '' || ageRank(band) >= ageRank(role.minAge); }

  function render() {
    rolesEl.innerHTML = VOLUNTEER_ROLES.map(r => {
      const full = r.filled >= r.target;
      const elig = eligible(r);
      const disabled = full || !elig;
      if (disabled) selected.delete(r.id);
      const checked = selected.has(r.id);
      let cap;
      if (full) cap = '<span class="cap full">Full</span>';
      else cap = `<span class="cap${r.target - r.filled <= 2 ? ' low' : ''}">${r.filled} of ${r.target} filled</span>`;
      const ageReq = `Min age: ${ageLabel(r.minAge)}`;
      const note = !elig && !full ? ` · <span class="cap full">Needs ${ageLabel(r.minAge)}</span>` : '';
      const clr = r.clearance ? ' · <span class="muted">training required</span>' : '';
      return `<label class="svc${checked ? ' checked' : ''}${disabled ? ' full' : ''}">
        <input type="checkbox" data-role="${r.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="meta"><span class="nm">${r.name}</span>
          <span class="cap">${ageReq} · shift ${r.shift}${clr}${note}</span></span>
        ${cap}
      </label>`;
    }).join('');
  }

  rolesEl.addEventListener('change', e => {
    const id = e.target.dataset.role; if (!id) return;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    render();
  });

  $('#ageBand').addEventListener('change', e => {
    band = e.target.value;
    const minor = band === 'under_16' || band === '16_17';
    $('#minorConsent').style.display = minor ? 'block' : 'none';
    render();
  });

  $('#fillVol')?.addEventListener('click', () => {
    $('#volName').value = 'Aisha Khan'; $('#volEmail').value = 'aisha@example.com';
    $('#volPhone').value = '(555) 778-2231'; $('#schoolName').value = ''; $('#advisorName').value = '';
    $('#skills').value = 'Spanish, driving'; $('#ecName').value = 'Sara Khan'; $('#ecPhone').value = '(555) 778-0000';
    $('#ageBand').value = '18_plus'; $('#tshirt').value = 'M';
    band = '18_plus'; $('#minorConsent').style.display = 'none';
    selected = new Set(['reg', 'greet']);
    render();
  });

  $('#volSubmit').addEventListener('click', () => {
    if (!$('#volName').value.trim() || !$('#volEmail').value.trim()) { alert('Name and email are required.'); return; }
    if (!band) { alert('Please choose an age group.'); return; }
    if (selected.size === 0) { alert('Pick at least one role preference.'); return; }
    if (!$('#ecName').value.trim() || !$('#ecPhone').value.trim()) { alert('An emergency contact is required.'); return; }
    const minor = band === 'under_16' || band === '16_17';
    if (minor && !$('#guardianName').value.trim()) { alert('A parent/guardian name is required to sign up a minor.'); return; }

    const prefs = [...selected];
    const top = VOLUNTEER_ROLES.find(r => r.id === prefs[0]);
    saveVolunteer({
      volId: nextVolId(),
      name: $('#volName').value.trim(),
      email: $('#volEmail').value.trim(),
      phone: $('#volPhone').value.trim(),
      ageBand: band,
      school: $('#schoolName').value.trim(),
      advisor: $('#advisorName').value.trim(),
      skills: $('#skills').value.trim(),
      tshirt: $('#tshirt').value,
      emergency: { name: $('#ecName').value.trim(), phone: $('#ecPhone').value.trim() },
      minor, guardian: minor ? $('#guardianName').value.trim() : null,
      prefs, assignedRole: top.id, status: 'confirmed',
    });
    location.href = 'volunteer-confirm.html';
  });

  render();
}

/* ---------- volunteer confirmation ---------- */
function initVolunteerConfirm() {
  const v = loadVolunteer();
  const root = $('#volConfirm');
  if (!v) {
    root.innerHTML = `<div class="card"><p>No volunteer signup found in this demo session.</p>
      <a class="ds-btn primary" href="volunteer.html">Sign up</a></div>`;
    return;
  }
  const r = VOLUNTEER_ROLES.find(x => x.id === v.assignedRole);
  const arrival = r.shift.split(/[–·]/)[0].trim();
  $('#volSummary').innerHTML = `Acknowledgement sent to <b>${v.email}</b> · volunteer ID
    <span class="ds-mono">${v.volId}</span>`;
  root.innerHTML = `
    <div class="card" style="max-width:460px">
      <div class="ds-eyebrow">You're confirmed for</div>
      <div class="ds-name" style="font-size:22px;margin:4px 0 2px">${r.name}</div>
      <div class="muted">${CAMP.name} · Saturday, December 6</div>
      <ul class="checks" style="margin-top:12px">
        <li><span class="tick">●</span> Shift: <b>&nbsp;${r.shift}</b></li>
        <li><span class="tick">●</span> Arrive by: <b>&nbsp;${arrival}</b></li>
        <li><span class="tick">●</span> Venue: <b>&nbsp;dcica Clinic, registration tent</b></li>
      </ul>
      <div class="ds-paid" style="border-top:1px solid var(--hairline);margin-top:10px"><b>Your role:</b> ${r.instr}</div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--hairline)">
        <div class="ds-qr"></div>
        <div style="font-size:13.5px">Scan this QR at the volunteer desk to <b>sign in</b> on camp day,
          and again to <b>sign out</b> — your hours are computed automatically.</div>
      </div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">Can't make it?
        <a href="#" onclick="return false">Release my slot</a> — the next waitlisted volunteer is auto-offered.</p>
    </div>`;
}

/* ---------- volunteer coordinator dashboard ---------- */
function hoursBetween(a, b) {
  if (!a || !b) return 0;
  const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number);
  return Math.round(((bh * 60 + bm) - (ah * 60 + am)) / 6) / 10; // hours, 1dp
}
function initVolunteerDashboard() {
  const STATUS_LABEL = { confirmed: 'Confirmed', checked_in: 'On site', checked_out: 'Checked out', no_show: 'No-show' };
  let roster = VOL_ROSTER.map(r => ({ ...r }));

  function counts() {
    const signed = VOLUNTEER_ROLES.reduce((s, r) => s + r.filled, 0);
    const onsite = roster.filter(r => r.status === 'checked_in').length;
    const out = roster.filter(r => r.status === 'checked_out').length;
    const ns = roster.filter(r => r.status === 'no_show').length;
    return { signed, onsite, out, ns };
  }

  function render() {
    const c = counts();
    $('#volTiles').innerHTML = `
      <div class="ds-tile"><div class="cap">Signed up</div><div class="big">${c.signed}</div></div>
      <div class="ds-tile"><div class="cap">On site now</div><div class="big">${c.onsite}</div></div>
      <div class="ds-tile"><div class="cap">Checked out</div><div class="big">${c.out}</div></div>
      <div class="ds-tile"><div class="cap">No-shows</div><div class="big${c.ns ? ' warn' : ''}">${c.ns}</div></div>`;

    $('#volCapacity').innerHTML = VOLUNTEER_ROLES.map(r => {
      const full = r.filled >= r.target;
      const pct = Math.round((r.filled / r.target) * 100);
      return `<div class="ds-row" style="cursor:default">
        <span class="who"><span class="nm">${r.name}</span>
          <span class="id" style="font-family:inherit">${r.shift} · min ${ageLabel(r.minAge)}</span></span>
        <span class="ds-pill ${full ? 'done' : 'queued'}" style="font-family:'Spline Sans Mono',monospace">${r.filled}/${r.target}${full ? ' full' : ''}</span>
      </div>`;
    }).join('');

    $('#volSources').innerHTML = VOL_SOURCES.map(s =>
      `<span class="ds-soc"><b class="ds-mono" style="color:var(--saffron-700)">${s.count}</b>&nbsp; ${s.label}</span>`).join('');

    $('#volRoster').innerHTML = roster.map((r, i) => {
      const role = VOLUNTEER_ROLES.find(x => x.id === r.role);
      const pillClass = r.status === 'checked_in' ? 'active' : (r.status === 'no_show' ? 'done' : (r.status === 'checked_out' ? 'done' : 'queued'));
      const hrs = r.status === 'checked_out' ? `<span class="muted" style="font-size:12px">${hoursBetween(r.planIn, r.planOut)}h</span>` : '';
      const clickable = r.status === 'confirmed' || r.status === 'checked_in';
      return `<button class="ds-row" data-i="${i}" ${clickable ? '' : 'style="cursor:default"'}>
        <span class="who"><span class="nm">${r.name}</span><span class="id" style="font-family:inherit">${role.name}${r.inAt ? ' · in ' + (r.status === 'checked_out' ? r.planIn : r.planIn || r.inAt) : ''}${r.status === 'checked_out' ? ' · out ' + r.planOut : ''}</span></span>
        ${hrs}<span class="ds-pill ${pillClass}">${STATUS_LABEL[r.status]}</span>
      </button>`;
    }).join('');

    $all('#volRoster .ds-row').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.i); const r = roster[i];
      if (r.status === 'confirmed') { r.status = 'checked_in'; r.inAt = r.planIn; }
      else if (r.status === 'checked_in') { r.status = 'checked_out'; }
      render();
    }));
  }
  render();

  $('#sendReminders')?.addEventListener('click', () => {
    $('#reminderNote').textContent = 'Confirmation emails sent to all signed-up volunteers (24–48h reminder, with sign-in QR). Unopened will be re-sent.';
  });
}

/* ---------- volunteer certificate (printable) ---------- */
function initVolunteerCertificate() {
  const v = loadVolunteer();
  const name = v ? v.name : 'Aisha Khan';
  const roleId = v ? v.assignedRole : 'reg';
  const role = VOLUNTEER_ROLES.find(r => r.id === roleId) || VOLUNTEER_ROLES[0];
  const hours = '4.5';
  $('#cert').innerHTML = `
    <div class="ds-eyebrow" style="color:var(--saffron-700)">Certificate of Appreciation</div>
    <h2 class="ds-disp" style="font-size:30px;margin:8px 0 4px">${name}</h2>
    <p class="muted" style="margin:0">is recognized for volunteer service at</p>
    <p class="ds-disp" style="font-size:20px;margin:6px 0 0">${CAMP.name}</p>
    <div style="display:flex;gap:26px;flex-wrap:wrap;margin:18px 0 0">
      <div><div class="ds-eyebrow">Role</div><div style="font-weight:600">${role.name}</div></div>
      <div><div class="ds-eyebrow">Hours served</div><div class="ds-mono" style="font-weight:600">${hours} h</div></div>
      <div><div class="ds-eyebrow">Date</div><div class="ds-mono">${CAMP.date}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;padding-top:16px;border-top:1px solid var(--hairline)">
      <div><div class="ds-disp" style="font-size:18px">${ORG.name}</div>
        <div class="muted" style="font-size:12px">501(c)(3) non-profit · verify at ${ORG.contact}</div></div>
      <div style="text-align:right"><div style="border-top:1.5px solid var(--ink);width:160px"></div>
        <div class="muted" style="font-size:12px">Authorized signature</div></div>
    </div>`;
  $('#printCert')?.addEventListener('click', () => window.print());
}

/* ============================================================================
   VENDOR — application
   ========================================================================== */
function initVendor() {
  const typeSel = $('#vType'), spaceSel = $('#vSpace');
  typeSel.innerHTML = '<option value="">Select type…</option>' +
    VENDOR_TYPES.map(t => `<option value="${t.id}">${t.label} — $${t.rate} (${t.note})</option>`).join('');
  spaceSel.innerHTML = VENDOR_SPACES.map(s =>
    `<option value="${s.id}">${s.label}${s.add ? ' (+$' + s.add + ')' : ''} — ${s.note}</option>`).join('');

  function updateFee() {
    const fee = vendorFee(typeSel.value, spaceSel.value);
    $('#vFee').textContent = typeSel.value ? money(fee) : '—';
  }
  typeSel.addEventListener('change', updateFee);
  spaceSel.addEventListener('change', updateFee);
  updateFee();

  $('#fillVendor')?.addEventListener('click', () => {
    $('#bizName').value = 'Spice Route Catering'; $('#vContact').value = 'Meena R.';
    $('#vPhone').value = '(555) 200-1188'; $('#vEmail').value = 'meena@spiceroute.example';
    typeSel.value = 'food'; spaceSel.value = 'double'; updateFee();
  });

  $('#vSubmit').addEventListener('click', () => {
    if (!$('#bizName').value.trim() || !$('#vEmail').value.trim() || !typeSel.value) {
      alert('Business name, email, and vendor type are required.'); return;
    }
    const v = {
      id: nextVendorId(), business: $('#bizName').value.trim(), contact: $('#vContact').value.trim(),
      phone: $('#vPhone').value.trim(), email: $('#vEmail').value.trim(),
      type: typeSel.value, space: spaceSel.value, fee: vendorFee(typeSel.value, spaceSel.value),
      status: 'pending', payment: 'unpaid', booth: null,
    };
    saveVendor(v);
    $('#vForm').style.display = 'none';
    $('#vResult').innerHTML = `<div class="card">
      <h3 class="ds-disp" style="margin:0 0 6px">Application received ✓</h3>
      <p class="muted" style="margin:0 0 10px">Your vendor ID is <span class="ds-mono">${v.id}</span> —
        the committee will review and email you Zelle payment instructions if approved.</p>
      <div class="ds-paid" style="border-top:1px solid var(--hairline)"><b>Fee if approved:</b>
        <span class="ds-mono">${money(v.fee)}</span> — paid by Zelle (no card fees on vendor amounts).</div>
      <a class="ds-btn primary" href="vendor-admin.html" style="margin-top:14px">Open committee review →</a>
    </div>`;
  });
}

/* ---------- vendor committee review (admin) ---------- */
function initVendorAdmin() {
  let v = loadVendor() || {
    id: 'V-2026W-003', business: 'Spice Route Catering', contact: 'Meena R.', phone: '(555) 200-1188',
    email: 'meena@spiceroute.example', type: 'food', space: 'double',
    fee: vendorFee('food', 'double'), status: 'pending', payment: 'unpaid', booth: null,
  };
  const typeLabel = id => (VENDOR_TYPES.find(t => t.id === id) || {}).label || id;
  const spaceLabel = id => (VENDOR_SPACES.find(s => s.id === id) || {}).label || id;
  let rejectMode = false;

  function render() {
    const statusPill = {
      pending: '<span class="ds-pill queued">Pending</span>',
      approved: '<span class="ds-pill active">Approved</span>',
      rejected: '<span class="ds-pill done">Rejected</span>',
      confirmed: '<span class="ds-pill done" style="background:#E6F2EA;color:var(--s-ok)">Confirmed</span>',
    }[v.status];

    let action = '';
    if (v.status === 'pending' && !rejectMode) {
      action = `<button class="ds-btn primary" id="approveBtn">Approve</button>
                <button class="ds-btn ghost" id="rejectBtn">Reject</button>`;
    } else if (rejectMode) {
      action = `<div class="ds-field"><label>Rejection reason (emailed to vendor)</label>
        <input class="ds-input" id="rejReason" placeholder="e.g. Food category already full"></div>
        <button class="ds-btn primary" id="confirmReject">Send rejection</button>`;
    } else if (v.status === 'rejected') {
      action = `<div class="ds-error" style="max-width:none"><span class="ic">✕</span>
        <span class="tx"><b>Rejected.</b> Email sent to ${v.email}${v.rejReason ? ' — “' + v.rejReason + '”' : ''}.</span></div>`;
    } else if (v.status === 'approved' && v.payment === 'unpaid') {
      action = `<div class="ds-alert" style="max-width:none"><span class="ic">$</span>
        <span class="tx"><b>Approval email sent.</b> Vendor pays by Zelle to
        <b>${VENDOR_ZELLE}</b>, amount <b>${money(v.fee)}</b>, memo <span class="ds-mono">${v.id}</span>.</span></div>
        <button class="ds-btn primary" id="markPaid" style="margin-top:12px">Mark payment received (verified in bank app)</button>`;
    } else if (v.payment === 'received' && !v.booth) {
      action = `<p style="margin:0 0 8px"><b>Payment received.</b> Assign a booth:</p>
        <div id="boothGrid" class="booth-grid"></div>`;
    } else if (v.status === 'confirmed') {
      action = `<div class="ds-alert" style="max-width:none;background:#E6F2EA;border-color:var(--s-ok)">
        <span class="ic" style="background:var(--s-ok)">✓</span>
        <span class="tx"><b>Confirmed — booth ${v.booth}.</b> Confirmation email sent with booth number and setup window.</span></div>
        <a class="ds-btn primary" href="vendor-confirm.html" style="margin-top:12px">View vendor's confirmation →</a>`;
    }

    $('#vendorCard').innerHTML = `
      <div class="attendee-head"><span class="ttl">${v.business}</span>${statusPill}</div>
      <div class="muted" style="font-size:13.5px;margin-bottom:10px">${v.contact || '—'} · ${v.email} · ${v.phone || ''}</div>
      <div class="dot-row" style="gap:18px">
        <div><div class="ds-eyebrow">Type</div><div>${typeLabel(v.type)}</div></div>
        <div><div class="ds-eyebrow">Space</div><div>${spaceLabel(v.space)}</div></div>
        <div><div class="ds-eyebrow">Fee due</div><div class="ds-mono">${money(v.fee)}</div></div>
        <div><div class="ds-eyebrow">Vendor ID</div><div class="ds-mono">${v.id}</div></div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--hairline)">${action}</div>`;

    wire();
  }

  function renderBooths() {
    const grid = $('#boothGrid'); if (!grid) return;
    grid.innerHTML = BOOTH_SLOTS.map(b => {
      const taken = !!b.vendor;
      return `<button class="booth ${taken ? 'taken' : 'free'}" data-b="${b.id}" ${taken ? 'disabled' : ''}>
        <span class="bid ds-mono">${b.id}</span><span class="btype">${b.type}</span>
        ${taken ? `<span class="bv">${b.vendor}</span>` : '<span class="bv free">free</span>'}</button>`;
    }).join('');
    $all('.booth.free', grid).forEach(btn => btn.addEventListener('click', () => {
      v.booth = btn.dataset.b; v.payment = 'confirmed'; v.status = 'confirmed';
      const slot = BOOTH_SLOTS.find(s => s.id === v.booth); if (slot) slot.vendor = v.business;
      saveVendorConfirmed(v); render();
    }));
  }

  function wire() {
    $('#approveBtn')?.addEventListener('click', () => { v.status = 'approved'; render(); });
    $('#rejectBtn')?.addEventListener('click', () => { rejectMode = true; render(); });
    $('#confirmReject')?.addEventListener('click', () => { v.rejReason = $('#rejReason').value.trim(); v.status = 'rejected'; rejectMode = false; render(); });
    $('#markPaid')?.addEventListener('click', () => { v.payment = 'received'; render(); });
    renderBooths();
  }

  // read-only context queue
  $('#vendorQueue').innerHTML = SAMPLE_VENDORS.map(s => `
    <div class="ds-row" style="cursor:default">
      <span class="who"><span class="nm">${s.business}</span>
        <span class="id">${s.id} · ${typeLabel(s.type)}/${spaceLabel(s.space)}</span></span>
      <span class="ds-pill ${s.status === 'pending' ? 'queued' : 'done'}">${s.status}</span>
    </div>`).join('');

  render();
}

/* ---------- vendor confirmation ---------- */
function initVendorConfirm() {
  const v = loadVendorConfirmed();
  const root = $('#vendorConfirm');
  if (!v) {
    root.innerHTML = `<div class="card"><p>No confirmed vendor in this demo session.</p>
      <a class="ds-btn primary" href="vendor-admin.html">Open committee review</a></div>`;
    return;
  }
  const t = VENDOR_TYPES.find(x => x.id === v.type) || {};
  root.innerHTML = `<div class="card" style="max-width:460px">
    <div class="ds-eyebrow" style="color:var(--s-ok)">You're confirmed</div>
    <h3 class="ds-disp" style="margin:6px 0 2px">${v.business}</h3>
    <div class="muted">${CAMP.name} · Saturday, December 6</div>
    <ul class="checks" style="margin-top:12px">
      <li><span class="tick">●</span> Booth: <b>&nbsp;${v.booth}</b> <span class="muted">(${t.label || v.type})</span></li>
      <li><span class="tick">●</span> Setup window: <b>&nbsp;6:30–8:00 AM</b></li>
      <li><span class="tick">●</span> Fee paid: <b>&nbsp;${money(v.fee)}</b> via Zelle (memo ${v.id})</li>
    </ul>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">Bring your own table covering and power strip;
      one 6ft table is provided. Teardown by 3:00 PM.</p>
  </div>`;
}

/* ============================================================================
   LOGISTICS — Supply Calculator
   ========================================================================== */
function initSupply() {
  const d = {};
  SUPPLY_DRIVERS.forEach(x => d[x.id] = x.val);
  const overrides = {};

  $('#drivers').innerHTML = SUPPLY_DRIVERS.map(x =>
    `<div class="ds-field" style="margin-bottom:0"><label>${x.label}</label>
      <input class="ds-input" data-d="${x.id}" inputmode="numeric" value="${x.val}"></div>`).join('');

  function renderTable() {
    const cats = ['Medical', 'Food', 'Stationery'];
    $('#supplyTable').innerHTML = cats.map(cat => {
      const rows = SUPPLY_RULES.filter(r => r.cat === cat).map((r, i) => {
        const computed = r.calc(d);
        const ov = overrides[r.item];
        const qty = (ov === undefined || ov === '') ? computed : ov;
        return `<div class="ds-row" style="cursor:default">
          <span class="who" style="flex:1"><span class="nm">${r.item}</span></span>
          <span class="ds-mono muted" style="font-size:12.5px;width:64px;text-align:right">${computed}</span>
          <input class="ds-input" data-ov="${r.item}" value="${ov !== undefined ? ov : ''}" placeholder="${computed}"
            inputmode="numeric" style="width:80px;min-height:40px;margin-left:10px;text-align:right">
        </div>`;
      }).join('');
      return `<div class="ds-eyebrow" style="margin:16px 0 6px">${cat}</div>
        <div class="card" style="padding:0">
          <div class="ds-row" style="cursor:default;background:var(--field)">
            <span class="who" style="flex:1"><span class="id" style="font-family:inherit">Item</span></span>
            <span class="muted" style="font-size:11px;width:64px;text-align:right">Suggested</span>
            <span class="muted" style="font-size:11px;width:80px;text-align:right;margin-left:10px">Order</span>
          </div>${rows}</div>`;
    }).join('');

    $all('[data-ov]').forEach(inp => inp.addEventListener('input', e => {
      overrides[e.target.dataset.ov] = e.target.value;
    }));
  }

  $('#drivers').addEventListener('input', e => {
    const id = e.target.dataset.d; if (!id) return;
    d[id] = parseInt(e.target.value, 10) || 0;
    renderTable();
  });
  $('#printSupply')?.addEventListener('click', () => window.print());
  renderTable();
}

/* ============================================================================
   LOGISTICS — Operations Checklist (+ printable signs)
   ========================================================================== */
function initChecklist() {
  const CAT_LABEL = { signage: 'Signage', supplies: 'Supplies', tech: 'Tech', logistics: 'Logistics', system: 'System' };
  const data = CHECKLIST.map(p => ({ phase: p.phase, items: p.items.map(i => ({ ...i })) }));

  function render() {
    $('#checklist').innerHTML = data.map((p, pi) => {
      const done = p.items.filter(i => i.done).length;
      const rows = p.items.map((it, ii) => `
        <label class="svc${it.done ? ' checked' : ''}">
          <input type="checkbox" data-p="${pi}" data-i="${ii}" ${it.done ? 'checked' : ''}>
          <span class="meta"><span class="nm" style="${it.done ? 'text-decoration:line-through;color:var(--ink-muted)' : ''}">${it.desc}</span>
            <span class="cap">${CAT_LABEL[it.cat]} · ${it.role}${it.print ? ' · <b style="color:var(--saffron-700)">prints a sign</b>' : ''}</span></span>
        </label>`).join('');
      return `<div style="margin-bottom:20px">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px">
          <span class="section-head" style="margin:0;font-size:18px">${p.phase}</span>
          <span class="ds-pill ${done === p.items.length ? 'done' : 'queued'}" style="font-family:'Spline Sans Mono',monospace">${done}/${p.items.length}</span>
        </div>
        <div class="svc-list">${rows}</div></div>`;
    }).join('');

    $all('#checklist input[type=checkbox]').forEach(cb => cb.addEventListener('change', e => {
      data[e.target.dataset.p].items[e.target.dataset.i].done = e.target.checked;
      render();
    }));
  }
  render();
  $('#printChecklist')?.addEventListener('click', () => window.print());

  // printable artifacts
  const signTime = '10:00 AM';
  $('#signs').innerHTML = `
    <div class="sign sign-hold">
      <div class="sign-k">Walk-in registration</div>
      <div class="sign-big">Opens at <input id="holdTime" value="${signTime}" style="font:inherit;border:none;border-bottom:2px dashed var(--ink);background:transparent;width:5em;text-align:center"></div>
      <div class="sign-sub">Please take a seat in the waiting area — you'll be called.</div>
    </div>
    <div class="sign" style="border-top:8px solid var(--st-ultra)">
      <div class="sign-k">Station directional</div>
      <div class="sign-big" style="display:flex;align-items:center;gap:10px"><span class="ds-dot" style="background:var(--st-ultra);width:40px;height:40px;font-size:18px">U</span> Ultrasound →</div>
      <div class="sign-sub">Follow the blue dots</div>
    </div>
    <div class="sign sign-dark">
      <div class="sign-k" style="color:#cfd6d3">Now serving</div>
      <div class="sign-big ds-mono" style="font-size:48px">0147</div>
    </div>
    <div class="sign"><div class="sign-k">Please note</div><div class="sign-big">📷 No photography</div>
      <div class="sign-sub">Respect everyone's privacy</div></div>
    <div class="sign"><div class="sign-k">Before you check in</div><div class="sign-big">Have your waiver ready</div>
      <div class="sign-sub">Minors need a parent/guardian signature</div></div>`;
}

/* ============================================================================
   LOGISTICS — Lab tracking (staff)
   ========================================================================== */
function initLab() {
  const STATUS = { pending: 'Pending', received: 'Received', mailed: 'Mailed' };

  function render() {
    const m = loadLab();
    $('#labList').innerHTML = LAB_SAMPLES.map(s => {
      const st = m[s.campId] || { status: 'pending', mailed: null };
      const pill = st.status === 'pending' ? 'queued' : (st.status === 'received' ? 'active' : 'done');
      let action = '';
      if (st.status === 'pending') action = `<button class="ds-btn ghost" data-recv="${s.campId}" style="min-height:38px;padding:0 12px">Mark received</button>`;
      else if (st.status === 'received') action = `<button class="ds-btn ghost" data-mail="${s.campId}" style="min-height:38px;padding:0 12px">Mark mailed</button>`;
      else action = `<span class="muted" style="font-size:12px">Mailed ${st.mailed}</span>`;
      return `<div class="ds-row" style="cursor:default">
        <span class="who"><span class="nm">${s.name}</span><span class="id">${s.campId} · ${s.test}</span></span>
        <span class="ds-pill ${pill}">${STATUS[st.status]}</span>
        <span style="margin-left:10px">${action}</span>
      </div>`;
    }).join('');

    $all('[data-recv]').forEach(b => b.addEventListener('click', () => {
      const m2 = loadLab(); m2[b.dataset.recv] = { status: 'received', mailed: null }; saveLab(m2); render();
    }));
    $all('[data-mail]').forEach(b => b.addEventListener('click', () => {
      const m2 = loadLab(); m2[b.dataset.mail] = { status: 'mailed', mailed: todayStr() }; saveLab(m2); render();
    }));

    // address labels for received-not-mailed
    const m3 = loadLab();
    const toMail = LAB_SAMPLES.filter(s => (m3[s.campId] || {}).status === 'received');
    $('#labels').innerHTML = toMail.length
      ? toMail.map(s => `<div class="addr-label"><div style="font-weight:700">${s.name}</div>
          <div class="muted" style="font-size:12px">${s.address}</div>
          <div class="ds-mono" style="font-size:11px;color:var(--ink-muted);margin-top:4px">${s.campId}</div></div>`).join('')
      : '<p class="muted" style="font-size:13.5px">Mark a patient “received” to queue an address label here.</p>';
  }
  render();

  $('#markAllRecv')?.addEventListener('click', () => {
    const m = loadLab();
    LAB_SAMPLES.forEach(s => { if (!m[s.campId] || m[s.campId].status === 'pending') m[s.campId] = { status: 'received', mailed: null }; });
    saveLab(m); render();
  });
  $('#printLabels')?.addEventListener('click', () => window.print());
}

/* ---------- patient lab-status lookup (public, no login) ---------- */
function initLabStatus() {
  $('#labLookupBtn').addEventListener('click', () => {
    const code = $('#labCode').value.trim().toUpperCase();
    const out = $('#labStatusResult');
    if (!code) { out.innerHTML = '<p class="muted">Enter your camp code.</p>'; return; }
    const known = LAB_SAMPLES.find(s => s.campId.toUpperCase() === code);
    const st = labStatus(code);
    const steps = ['pending', 'received', 'mailed'];
    const at = steps.indexOf(st.status);
    const label = {
      pending: 'Lab pending', received: 'Lab received',
      mailed: st.status === 'mailed' ? `Mailed on ${st.mailed}` : 'Mailed',
    };
    out.innerHTML = `<div class="card" style="max-width:380px">
      <div class="ds-id">${code}${known ? ' · ' + known.name : ''}</div>
      <div class="ds-spine" style="margin-top:10px;border-radius:8px">
        ${steps.map((s, i) => `<div class="ds-band" style="background:${i <= at ? 'var(--s-ok)' : 'var(--s-queued)'}">
          <span class="gly">${i + 1}</span><span class="lbl">${label[s]}</span>
          <span class="box">${i <= at ? '✓' : ''}</span></div>`).join('')}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Logistics status only — no clinical results are shown here.</p>
    </div>`;
  });
}

/* ============================================================================
   LOGISTICS — Venue configuration
   ========================================================================== */
function initVenue() {
  let cur = 'clinic';
  function render() {
    const v = VENUES[cur];
    $('#venueClinic').className = 'ds-btn ' + (cur === 'clinic' ? 'primary' : 'ghost');
    $('#venueOpen').className = 'ds-btn ' + (cur === 'open' ? 'primary' : 'ghost');
    $('#venueOut').innerHTML = `
      <h2 class="section-head">${v.name}</h2>
      <div class="card" style="padding:0">
        ${v.zones.map(z => `<div class="ds-row" style="cursor:default">
          <span class="who"><span class="nm">${z.zone}</span></span>
          <span class="muted" style="font-size:13.5px">${z.loc}</span></div>`).join('')}
      </div>
      ${v.note ? `<div class="ds-alert" style="max-width:none;margin-top:14px"><span class="ic">i</span><span class="tx">${v.note}</span></div>` : ''}`;
  }
  $('#venueClinic').addEventListener('click', () => { cur = 'clinic'; render(); });
  $('#venueOpen').addEventListener('click', () => { cur = 'open'; render(); });
  render();
}

/* Load-sample-data control (Home page). */
function wireSeed() {
  $all('[data-seed]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    seedDemoData();
    location.href = a.getAttribute('data-seed') || 'index.html';
  }));
}

document.addEventListener('DOMContentLoaded', () => { wireReset(); wireSeed(); });
