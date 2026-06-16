/* ============================================================================
   MedCamp demo — seed data
   Service menu / prices from docs/MedCamp-System-Overview.md (lines 85–96).
   Station colors + letter glyphs + routing order from docs/Design-System.md.
   All numbers are illustrative seeds for the committee walk-through.
   ========================================================================== */

const CAMP = { id: '2026W', name: 'dcica Winter Camp 2026', date: '2026-12-06' };

/* Stations in routing order. `order` drives the Care Spine sequence. */
const STATIONS = {
  V: { letter: 'V', label: 'Vitals',      color: 'var(--st-vitals)', order: 1 },
  D: { letter: 'D', label: 'Doctor',      color: 'var(--st-doctor)', order: 2 },
  B: { letter: 'B', label: 'Blood draw',  color: 'var(--st-blood)',  order: 3 },
  U: { letter: 'U', label: 'Ultrasound',  color: 'var(--st-ultra)',  order: 4 },
  X: { letter: 'X', label: 'X-Ray',       color: 'var(--st-xray)',   order: 5 },
  E: { letter: 'E', label: 'EKG',         color: 'var(--st-ekg)',    order: 6 },
  S: { letter: 'S', label: 'Shots',       color: 'var(--st-shots)',  order: 7 },
};

/* Service menu. `price` is the numeric amount used for the running total;
   `priceLabel` is what the patient sees. `cap`/`remaining` drive capacity. */
const SERVICES = [
  { id: 'consult1',  name: 'First consultation',       priceLabel: 'Free',        price: 0,  station: 'D', cap: null, remaining: null },
  { id: 'consult2',  name: 'Additional consultation',  priceLabel: '$5',          price: 5,  station: 'D', cap: null, remaining: null },
  { id: 'blood',     name: 'Blood test',               priceLabel: '$8–$15',      price: 12, station: 'B', cap: 200, remaining: 140, est: true },
  { id: 'ultra',     name: 'Ultrasound',               priceLabel: '$40',         price: 40, station: 'U', cap: 80,  remaining: 62 },
  { id: 'xray',      name: 'X-ray',                    priceLabel: '$40',         price: 40, station: 'X', cap: 60,  remaining: 0 },
  { id: 'shot',      name: 'Vitamin B12 or D shot',    priceLabel: '$10 / shot',  price: 10, station: 'S', cap: 100, remaining: 7 },
  { id: 'bloodbank', name: 'Blood bank',               priceLabel: 'Planned next camp', price: null, station: null, cap: 0, remaining: 0, disabled: true },
];

/* Every attendee walks Vitals → Doctor first; paid services add stations. */
const BASE_STATIONS = ['V', 'D'];

/* Build the ordered station letters for a patient from their chosen services. */
function spineFor(serviceIds) {
  const set = new Set(BASE_STATIONS);
  serviceIds.forEach(id => {
    const svc = SERVICES.find(s => s.id === id);
    if (svc && svc.station) set.add(svc.station);
  });
  return [...set].sort((a, b) => STATIONS[a].order - STATIONS[b].order);
}

/* Camp ID generator — MC-2026W-NNNN, persisted so demo IDs stay stable-ish. */
function nextCampId() {
  let n = parseInt(localStorage.getItem('mc_seq') || '147', 10) + 1;
  localStorage.setItem('mc_seq', String(n));
  return `MC-${CAMP.id}-${String(n).padStart(4, '0')}`;
}

/* Sample roster for the station-queue and dashboard screens (no real data). */
const SAMPLE_QUEUE = [
  { name: 'Priya Sharma', id: 'MC-2026W-0148', state: 'active' },
  { name: 'Anil Kumar',   id: 'MC-2026W-0151', state: 'queued' },
  { name: 'Ravi Desai',   id: 'MC-2026W-0153', state: 'queued' },
  { name: 'Meera Joshi',  id: 'MC-2026W-0144', state: 'done'   },
];

const DASHBOARD = {
  checkedIn: 312,
  inService: 48,
  needsPayment: 3,
  walkinOpen: false,
  queues: [
    { station: 'V', depth: 4 },
    { station: 'D', depth: 9 },
    { station: 'B', depth: 2 },
    { station: 'U', depth: 15 },
    { station: 'X', depth: 6 },
    { station: 'S', depth: 3 },
  ],
};

/* Persisted-registration helpers (carry register → confirmation / check-in). */
function saveRegistration(reg) { localStorage.setItem('mc_reg', JSON.stringify(reg)); }
function loadRegistration() {
  try { return JSON.parse(localStorage.getItem('mc_reg')); } catch (e) { return null; }
}
function resetDemo() {
  localStorage.removeItem('mc_reg');
  localStorage.removeItem('mc_seq');
  localStorage.removeItem('mc_vol');
  localStorage.removeItem('mc_vendor');
  localStorage.removeItem('mc_vendor_confirmed');
  localStorage.removeItem('mc_lab');
}

/* ============================================================================
   LOGISTICS — Supply Calculator  (System Overview, Module 6)
   Pre-camp only: registered counts per service → procurement list.
   ========================================================================== */
const SUPPLY_DRIVERS = [
  { id: 'patients', label: 'Total patients', val: 400 },
  { id: 'ultra',    label: 'Ultrasound',     val: 80 },
  { id: 'blood',    label: 'Blood tests',    val: 140 },
  { id: 'shots',    label: 'Vitamin shots',  val: 60 },
  { id: 'volunteers', label: 'Volunteers',   val: 35 },
];
const SUPPLY_RULES = [
  { item: 'Ultrasound gel (bottles)',      cat: 'Medical',     calc: d => Math.ceil(d.ultra / 25) },
  { item: 'Probe covers',                   cat: 'Medical',     calc: d => d.ultra },
  { item: 'Blood collection tubes',         cat: 'Medical',     calc: d => Math.ceil(d.blood * 1.2) },
  { item: 'Alcohol swabs',                  cat: 'Medical',     calc: d => d.blood * 2 + d.shots * 2 },
  { item: 'Adhesive bandages',              cat: 'Medical',     calc: d => d.blood + d.shots },
  { item: 'Syringes (1 mL)',                cat: 'Medical',     calc: d => d.shots },
  { item: 'B12 / D vials',                  cat: 'Medical',     calc: d => Math.ceil(d.shots / 10) },
  { item: 'Exam gloves (boxes of 100)',     cat: 'Medical',     calc: d => Math.ceil(d.patients / 50) },
  { item: 'Bottled water',                  cat: 'Food',        calc: d => Math.ceil(d.patients * 1.5 + d.volunteers * 3) },
  { item: 'Volunteer snack packs',          cat: 'Food',        calc: d => d.volunteers },
  { item: 'Coffee servings',                cat: 'Food',        calc: d => Math.ceil(d.patients / 3) },
  { item: 'Progress report sheets (A4)',    cat: 'Stationery',  calc: d => Math.ceil(d.patients * 1.1) },
  { item: 'Thermal sample labels',          cat: 'Stationery',  calc: d => Math.ceil(d.blood * 1.1) },
  { item: 'Pens',                           cat: 'Stationery',  calc: d => Math.ceil(d.patients / 20) },
  { item: 'Volunteer lanyards',             cat: 'Stationery',  calc: d => d.volunteers },
];

/* ============================================================================
   LOGISTICS — Operations Checklist  (System Overview, Module 7)
   ========================================================================== */
const CHECKLIST = [
  { phase: 'Pre-camp (week before)', items: [
    { desc: 'Confirm volunteer count and role assignments', cat: 'logistics', role: 'Volunteer Coordinator', print: false, done: true },
    { desc: 'Order supplies (medical, food, stationery) per supply calculator', cat: 'supplies', role: 'Committee', print: true, done: true },
    { desc: 'Print volunteer role cards', cat: 'signage', role: 'Volunteer Coordinator', print: true, done: false },
    { desc: 'Confirm lab partner and sample collection supplies', cat: 'logistics', role: 'Committee', print: false, done: false },
    { desc: 'Test the color printer and label printer with a sample run', cat: 'tech', role: 'Coordinator', print: false, done: false },
  ] },
  { phase: 'Day-of setup (before doors)', items: [
    { desc: 'Print and post walk-in hold sign at entrance and walk-in desk', cat: 'signage', role: 'Coordinator', print: true, done: false },
    { desc: 'Print and post station directional signs', cat: 'signage', role: 'Coordinator', print: true, done: false },
    { desc: 'Set up and test label printer at registration desk', cat: 'tech', role: 'Registration desk', print: false, done: false },
    { desc: 'Charge all tablets and scanners — confirm battery', cat: 'tech', role: 'Coordinator', print: false, done: false },
    { desc: 'Confirm WiFi coverage; activate hotspot backups', cat: 'tech', role: 'Coordinator', print: false, done: false },
    { desc: 'Load coordinator dashboard and confirm all stations showing', cat: 'system', role: 'Coordinator', print: false, done: false },
    { desc: 'Set walk-in registration open time on dashboard', cat: 'system', role: 'Coordinator', print: false, done: false },
    { desc: 'Brief volunteers on station and scanning procedure', cat: 'logistics', role: 'Coordinator', print: false, done: false },
  ] },
  { phase: 'During camp', items: [
    { desc: 'Open walk-in registration (~1 hour after open)', cat: 'system', role: 'Coordinator', print: false, done: false },
    { desc: 'Monitor queue depths — redistribute volunteers if a station backs up', cat: 'logistics', role: 'Coordinator', print: false, done: false },
    { desc: 'Confirm supply levels at blood draw and injection stations at midpoint', cat: 'supplies', role: 'Station volunteer', print: false, done: false },
  ] },
  { phase: 'Post-camp', items: [
    { desc: 'Export payment reconciliation report', cat: 'system', role: 'Coordinator', print: false, done: false },
    { desc: 'Export consented contacts list for membership drive', cat: 'system', role: 'Committee', print: false, done: false },
    { desc: 'Purge patient registration records', cat: 'system', role: 'Coordinator', print: false, done: false },
    { desc: 'Return borrowed tablets', cat: 'logistics', role: 'Coordinator', print: false, done: false },
    { desc: 'Log supply usage for next camp baseline', cat: 'supplies', role: 'Committee', print: false, done: false },
    { desc: 'Monitor for incoming lab results', cat: 'logistics', role: 'Committee', print: false, done: false },
  ] },
];

/* ============================================================================
   LOGISTICS — Post-camp Lab Tracking  (System Overview, Module 8)
   Logistics only — no clinical results stored. Status: pending → received → mailed.
   ========================================================================== */
const LAB_SAMPLES = [
  { campId: 'MC-2026W-0148', name: 'Priya Sharma', test: 'Blood panel', address: '12 Maple St, Edison, NJ 08820' },
  { campId: 'MC-2026W-0149', name: 'Aarav Sharma', test: 'Blood panel', address: '12 Maple St, Edison, NJ 08820' },
  { campId: 'MC-2026W-0151', name: 'Anil Kumar',   test: 'Blood panel', address: '88 Oak Ave, Iselin, NJ 08830' },
  { campId: 'MC-2026W-0162', name: 'Sara Lee',     test: 'Blood panel', address: '5 Birch Ct, Metuchen, NJ 08840' },
  { campId: 'MC-2026W-0177', name: 'Ravi Desai',   test: 'Blood panel', address: '204 Cedar Ln, Woodbridge, NJ 07095' },
];
function loadLab() { try { return JSON.parse(localStorage.getItem('mc_lab')) || {}; } catch (e) { return {}; } }
function saveLab(m) { localStorage.setItem('mc_lab', JSON.stringify(m)); }
function labStatus(campId) { const m = loadLab(); return m[campId] || { status: 'pending', mailed: null }; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ============================================================================
   LOGISTICS — Venue Configurations  (System Overview)
   ========================================================================== */
const VENUES = {
  clinic: { name: 'Configuration A — Clinic (current)', zones: [
    { zone: 'Registration / Check-in', loc: 'Clinic front' },
    { zone: 'Doctor consultations',    loc: '7 rooms' },
    { zone: 'Vitals',                  loc: 'Outdoor tent' },
    { zone: 'Blood draw',              loc: 'Outdoor tent' },
    { zone: 'Imaging (X-ray, Ultrasound)', loc: 'Clinic rooms' },
  ] },
  open: { name: 'Configuration B — Open space (gym / court)', zones: [
    { zone: 'Patient entry',           loc: 'Main entrance' },
    { zone: 'Waiting area',            loc: 'Open floor — numbered sections' },
    { zone: 'Registration / Check-in', loc: 'Table zone near entrance' },
    { zone: 'Doctor consultations',    loc: 'Portable cabins / dividers' },
    { zone: 'Vitals',                  loc: 'Cabin or open station' },
    { zone: 'Blood draw',              loc: 'Cabin' },
    { zone: 'Imaging',                 loc: 'Cabin or dedicated room' },
  ], note: 'TV screens near the waiting area show queue status by camp ID — patients see their number called without a volunteer announcing it.' },
};

/* ============================================================================
   VOLUNTEER MODULE  (docs/Volunteer-Module.md)
   Profiles persist across events — NOT camp-scoped, NOT PHI.
   ========================================================================== */

/* Age bands — ordered. A role's min_age requires this rank or higher. */
const AGE_BANDS = [
  { v: 'under_16', label: 'Under 16 · middle school', rank: 0 },
  { v: '16_17',    label: '16–17 · high school',      rank: 1 },
  { v: '18_plus',  label: '18 or older',              rank: 2 },
];
function ageRank(v) { const b = AGE_BANDS.find(a => a.v === v); return b ? b.rank : -1; }
function ageLabel(v) { const b = AGE_BANDS.find(a => a.v === v); return b ? b.label : v; }

/* Roles configured per event by the Volunteer Coordinator. */
const VOLUNTEER_ROLES = [
  { id: 'reg',    name: 'Registration desk', minAge: '16_17',   target: 6,  filled: 5, shift: '8:00–12:00', clearance: false, instr: 'Greet patients, verify check-in, hand out progress sheets. No payment till.' },
  { id: 'runner', name: 'Runner',            minAge: 'under_16', target: 8,  filled: 8, shift: '8:00–13:00', clearance: false, instr: 'Carry sheets and messages between stations.' },
  { id: 'greet',  name: 'Greeter',           minAge: 'under_16', target: 4,  filled: 1, shift: '7:30–11:00', clearance: false, instr: 'Welcome arrivals, direct to check-in, manage the waiting area.' },
  { id: 'vitals', name: 'Vitals assist',     minAge: '18_plus',  target: 4,  filled: 2, shift: '8:00–12:00', clearance: true,  instr: 'Assist the vitals station. Requires a short training/clearance.' },
  { id: 'crowd',  name: 'Crowd control',     minAge: '16_17',    target: 5,  filled: 3, shift: '8:00–13:00', clearance: false, instr: 'Keep queue lines orderly; manage walk-in waiting area.' },
  { id: 'setup',  name: 'Setup / teardown',  minAge: 'under_16', target: 10, filled: 4, shift: '6:30–8:00 · 13:00–14:30', clearance: false, instr: 'Tables, tents, signage before doors; pack-down after.' },
];

/* Outreach source tags for signup attribution. */
const VOL_SOURCES = [
  { tag: 'school', label: 'School', count: 18 },
  { tag: 'past',   label: 'Past volunteers', count: 11 },
  { tag: 'social', label: 'Social media', count: 6 },
  { tag: 'org',    label: 'Community orgs', count: 4 },
];

/* Day-of roster sample (status lifecycle: confirmed → checked_in → checked_out). */
const VOL_ROSTER = [
  { name: 'Aisha Khan',    role: 'reg',    status: 'checked_in',  inAt: '07:58' },
  { name: 'Diego Morales', role: 'runner', status: 'checked_in',  inAt: '08:05' },
  { name: 'Sam Patel',     role: 'greet',  status: 'confirmed',   inAt: null },
  { name: 'Lily Chen',     role: 'vitals', status: 'checked_out', inAt: '08:01', outAt: '12:10' },
  { name: 'Noah Williams', role: 'crowd',  status: 'no_show',     inAt: null },
];

const ORG = { name: 'dcica', is501c3: true, contact: 'admin@dcica.org' };

function nextVolId() {
  let n = parseInt(localStorage.getItem('mc_vol_seq') || '230', 10) + 1;
  localStorage.setItem('mc_vol_seq', String(n));
  return `VOL-${CAMP.id}-${String(n).padStart(4, '0')}`;
}
function saveVolunteer(v) { localStorage.setItem('mc_vol', JSON.stringify(v)); }
function loadVolunteer() { try { return JSON.parse(localStorage.getItem('mc_vol')); } catch (e) { return null; } }

/* ============================================================================
   VENDOR MODULE  (docs/Platform-Extensions.md)
   Apply → committee review → Zelle → booth assignment. Payment by Zelle/check.
   ========================================================================== */

/* Rates are illustrative (docs list them as "TBD per event, configurable"). */
const VENDOR_TYPES = [
  { id: 'food',        label: 'Food',        rate: 150, note: 'Commercial rate' },
  { id: 'merchandise', label: 'Merchandise', rate: 150, note: 'Commercial rate' },
  { id: 'nonprofit',   label: 'Non-profit',  rate: 50,  note: 'Discounted rate' },
  { id: 'education',   label: 'Education',    rate: 50,  note: 'Discounted rate' },
];
const VENDOR_SPACES = [
  { id: 'single', label: 'Single', add: 0,  note: 'Standard booth' },
  { id: 'double', label: 'Double', add: 75, note: 'Larger footprint' },
  { id: 'corner', label: 'Corner', add: 50, note: 'Premium location' },
];
function vendorFee(typeId, spaceId) {
  const t = VENDOR_TYPES.find(x => x.id === typeId);
  const s = VENDOR_SPACES.find(x => x.id === spaceId);
  return (t ? t.rate : 0) + (s ? s.add : 0);
}

/* Booth grid the committee assigns from. */
const BOOTH_SLOTS = [
  { id: 'A1', type: 'corner',   vendor: null }, { id: 'A2', type: 'standard', vendor: null },
  { id: 'A3', type: 'standard', vendor: 'Curry Express' }, { id: 'A4', type: 'standard', vendor: null },
  { id: 'B1', type: 'outdoor',  vendor: null }, { id: 'B2', type: 'outdoor',  vendor: 'Henna by Reena' },
  { id: 'B3', type: 'outdoor',  vendor: null }, { id: 'B4', type: 'corner',   vendor: null },
  { id: 'C1', type: 'indoor',   vendor: 'Sari Palace' }, { id: 'C2', type: 'indoor', vendor: null },
  { id: 'C3', type: 'indoor',   vendor: null }, { id: 'C4', type: 'standard', vendor: null },
];

/* Sample applications already in the committee queue (read-only context). */
const SAMPLE_VENDORS = [
  { id: 'V-2026W-003', business: 'Spice Route Catering', contact: 'Meena R.', type: 'food',      space: 'double', status: 'pending',  payment: 'unpaid' },
  { id: 'V-2026W-002', business: 'Desi Reads (books)',   contact: 'Arun K.',  type: 'education',  space: 'single', status: 'approved', payment: 'received' },
];
const VENDOR_ZELLE = 'payments@dcica.org';

function nextVendorId() {
  let n = parseInt(localStorage.getItem('mc_vendor_seq') || '003', 10) + 1;
  localStorage.setItem('mc_vendor_seq', String(n));
  return `V-${CAMP.id}-${String(n).padStart(3, '0')}`;
}
function saveVendor(v) { localStorage.setItem('mc_vendor', JSON.stringify(v)); }
function loadVendor() { try { return JSON.parse(localStorage.getItem('mc_vendor')); } catch (e) { return null; } }
function saveVendorConfirmed(v) { localStorage.setItem('mc_vendor_confirmed', JSON.stringify(v)); }
function loadVendorConfirmed() { try { return JSON.parse(localStorage.getItem('mc_vendor_confirmed')); } catch (e) { return null; } }

/* ============================================================================
   TEST DATA  — one call populates a completed record in each of the three
   modules, so every confirmation/lookup screen shows realistic content
   without having to fill a form first.
   ========================================================================== */
function labelsFor(ids) { return ids.map(id => SERVICES.find(s => s.id === id).name); }

function seedDemoData() {
  // —— Patient: a family of two (one adult, one minor) ——
  const a1 = ['consult1', 'ultra'];
  const a2 = ['consult1', 'blood'];
  saveRegistration({
    registrant: { name: 'Priya Sharma', email: 'priya@example.com', phone: '(555) 012-3456', address: '12 Maple St, Edison, NJ 08820' },
    marketingConsent: true, total: 52, camp: CAMP,
    attendees: [
      { campId: 'MC-2026W-0148', name: 'Priya Sharma', age: '34', isMinor: false, services: a1, stations: spineFor(a1), paidLabels: labelsFor(a1) },
      { campId: 'MC-2026W-0149', name: 'Aarav Sharma', age: '10', isMinor: true,  services: a2, stations: spineFor(a2), paidLabels: labelsFor(a2) },
    ],
  });
  localStorage.setItem('mc_seq', '149');

  // —— Volunteer: a confirmed adult volunteer ——
  saveVolunteer({
    volId: 'VOL-2026W-0231', name: 'Aisha Khan', email: 'aisha@example.com', phone: '(555) 778-2231',
    ageBand: '18_plus', school: '', advisor: '', skills: 'Spanish, driving', tshirt: 'M',
    emergency: { name: 'Sara Khan', phone: '(555) 778-0000' }, minor: false, guardian: null,
    prefs: ['reg', 'greet'], assignedRole: 'reg', status: 'confirmed',
  });
  localStorage.setItem('mc_vol_seq', '231');

  // —— Vendor: a confirmed vendor with an assigned booth ——
  saveVendorConfirmed({
    id: 'V-2026W-004', business: 'Spice Route Catering', contact: 'Meena R.', phone: '(555) 200-1188',
    email: 'meena@spiceroute.example', type: 'food', space: 'double', fee: vendorFee('food', 'double'),
    status: 'confirmed', payment: 'confirmed', booth: 'A2',
  });
  localStorage.setItem('mc_vendor_seq', '004');
}

/* True if any module already has a stored record. */
function hasDemoData() {
  return !!(localStorage.getItem('mc_reg') || localStorage.getItem('mc_vol') || localStorage.getItem('mc_vendor_confirmed'));
}
