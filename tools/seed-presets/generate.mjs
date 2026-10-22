#!/usr/bin/env node
/* tools/seed-presets — rebuild the fleet as ground-up workshop designs.
 *
 * Reads AIRCRAFT_FLEET from the client (single source of truth) and, for each
 * aircraft, generates a real FlightWorldWorkshop design: catalog parts, routed
 * wires (fuel / power / ground / hydraulic), named groups, cockpit hierarchy,
 * and research-consistent light fixtures. Output:
 *
 *   node tools/seed-presets/generate.mjs                       # print summary
 *   node tools/seed-presets/generate.mjs --out airplanecraft/presets-fleet.json
 *   node tools/seed-presets/generate.mjs --api http://localhost:3000   # POST as kind:'preset'
 *
 * Presets load through the same path as a user build: validateDesign ->
 * workshopRestoreSnapshot -> Test Fly. The procedural fleet path stays in the
 * client until parity is demonstrated (see TODO.md migration matrix).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = path.join(ROOT, 'airplanecraft', 'index.html');

/* ---------- extract AIRCRAFT_FLEET + WORKSHOP_PARTS from the client ---------- */
function extractClient() {
  const html = fs.readFileSync(CLIENT, 'utf8');
  const fleetTxt = html.match(/const AIRCRAFT_FLEET=\{([\s\S]*?)\n\};/)[1];
  const AIRCRAFT_FLEET = new Function('return {' + fleetTxt + '}')();
  const catTxt = html.match(/const WORKSHOP_PARTS=\{([\s\S]*?)\n\};/)[1];
  const WORKSHOP_PARTS = new Function('return {' + catTxt + '}')();
  return { AIRCRAFT_FLEET, WORKSHOP_PARTS };
}
const { AIRCRAFT_FLEET, WORKSHOP_PARTS } = extractClient();
const CATALOG = new Set(Object.keys(WORKSHOP_PARTS));

/* ---------- tiny builder: parts, wires, groups ---------- */
function makeBuilder() {
  const parts = [], wires = [], groups = [];
  let id = 0;
  const nextId = () => `part-${++id}`;
  const add = (type, pos, opts = {}) => {
    if (!CATALOG.has(type)) throw new Error(`unknown part type ${type}`);
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const p = {
      id: nextId(), type,
      name: opts.name || WORKSHOP_PARTS[type].name,
      position: { x: round(clamp(pos[0], -500, 500)), y: round(clamp(pos[1], -500, 500)), z: round(clamp(pos[2], -500, 500)) },
      rotation: { x: 0, y: 0, z: 0, ...(opts.rotation || {}) },
      scale: (() => {
        const s = { x: 1, y: 1, z: 1, ...(opts.scale || {}) };
        for (const a of ['x', 'y', 'z']) s[a] = round(clamp(s[a], .1, 20));
        return s;
      })(),
      color: opts.color || null,
      locked: false, symmetryPairId: null, symmetrySide: 0
    };
    parts.push(p);
    return p;
  };
  const mirror = (pair, port, starboard) => {
    port.symmetryPairId = pair; port.symmetrySide = 1;
    starboard.symmetryPairId = pair; starboard.symmetrySide = -1;
  };
  const wire = (a, b, kind) => wires.push({ from: a.id, to: b.id, kind });
  const group = (name, list) => groups.push({
    id: 'grp-' + (groups.length + 1), name, parts: list.map(p => p.id)
  });
  const byId = () => new Map(parts.map(p => [p.id, p]));
  return { parts, wires, groups, add, mirror, wire, group, byId };
}
const round = n => Math.round(n * 1000) / 1000;

/* ---------- per-aircraft design ---------- *
 * Coordinates follow the client: X right (port is -X), Y up, Z forward.
 * Wings sit along X, tail at -Z. All dims in metres from the fleet table. */
function designFor(cfg) {
  const b = makeBuilder();
  const L = cfg.length, W = cfg.bodyWidth, H = cfg.bodyHeight;
  const half = cfg.wingspan / 2;
  const wingY = cfg.wingPlacement === 'high' ? H * .78 : H * .18;
  const isDelta = /delta/i.test(cfg.role) || cfg.id === 'concorde';
  const isGlider = cfg.engineType === 'glider' || cfg.engineCount === 0;
  const heavy = (cfg.massKg || 0) > 8000;
  const jet = cfg.engineType === 'jet';

  /* --- structure: fuselage, wing, tail --- */
  const body = b.add('bodyBlock', [0, H * .5, 0], {
    name: 'Fuselage', scale: { x: W / 1.15, y: H / .82, z: Math.max(.5, L * .62 / 3.4) }
  });
  const nose = b.add('noseCone', [0, H * .5, L * .31], {
    name: 'Nose', scale: { x: W / .86, y: H / .62, z: L * .18 / 1.1 }
  });
  const tailCone = b.add('noseCone', [0, H * .5, -L * .33], {
    name: 'Tail cone', rotation: { y: Math.PI }, scale: { x: W / .86 * .8, y: H / .62 * .8, z: L * .15 / 1.1 }
  });
  let wingL, wingR;
  if (isDelta) {
    b.add('deltaWing', [0, H * .42, -L * .05], { name: 'Delta wing', scale: { x: half / 3.2, z: L * .45 / 2.8 } });
  } else {
    const type = half > 7 ? 'longWing' : 'wingPanel';
    const spanRef = type === 'longWing' ? 8.4 : 6.2;
    wingL = b.add(type, [-half / 2, wingY, 0], { name: 'Port wing', scale: { x: half / spanRef } });
    wingR = b.add(type, [half / 2, wingY, 0], { name: 'Starboard wing', scale: { x: half / spanRef } });
    b.mirror('mirror-1', wingL, wingR);
  }
  const hTail = Math.max(.3, cfg.wingspan * .3);
  const elevL = b.add('tailplane', [-hTail / 2, H * .5, -L * .4], { name: 'Port stabiliser', scale: { x: hTail / 2.25 } });
  const elevR = b.add('tailplane', [hTail / 2, H * .5, -L * .4], { name: 'Starboard stabiliser', scale: { x: hTail / 2.25 } });
  b.mirror('mirror-2', elevL, elevR);
  const fin = b.add('fin', [0, H + cfg.height * .18, -L * .4], { name: 'Vertical fin', scale: { y: cfg.height / 1.2 } });
  b.add('rudder', [0, H + cfg.height * .18, -L * .43], { name: 'Rudder' });

  /* --- propulsion --- */
  const engines = [];
  const engineType = jet ? 'jetEngine' : 'pistonEngine';
  if (cfg.engineCount === 1 && !isGlider) {
    const e = b.add(engineType, jet ? [0, H * .45, -L * .36] : [0, H * .55, L * .4], { name: 'Engine' });
    engines.push(e);
    if (!jet) b.add(cfg.propBlades >= 4 ? 'prop4' : 'prop2', [e.position.x, e.position.y, e.position.z + .55], { name: 'Propeller' });
  } else if (cfg.engineCount > 1) {
    const n = cfg.engineCount;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2);
      const x = side * (half * (.35 + rank * .25));
      const e = b.add(engineType, [x, wingY - .1, jet ? L * .18 : L * .05], { name: 'Engine ' + (i + 1) });
      engines.push(e);
      if (!jet) b.add(cfg.propBlades >= 4 ? 'prop4' : 'prop2', [x, e.position.y, e.position.z + .55], { name: 'Propeller ' + (i + 1) });
    }
  }

  /* --- landing gear --- */
  const gear = [];
  for (const x of [-W * .8, W * .8]) {
    const s = b.add('gearStrut', [x, H * .28, L * .04], { name: 'Main strut' });
    const w = b.add('wheel', [x, H * .1, L * .04], { name: 'Main wheel' });
    gear.push(s, w);
  }
  const ns = b.add('gearStrut', [0, H * .3, L * .3], { name: 'Nose strut', scale: { y: .8 } });
  const nw = b.add('wheel', [0, H * .12, L * .3], { name: 'Nose wheel', scale: { x: .7, y: .7, z: .7 } });
  gear.push(ns, nw);

  /* --- cockpit (named group so the cockpit is a group hierarchy) --- */
  const cockpit = [];
  cockpit.push(b.add('cockpitSeat', [-W * .25, H * .62, L * .16], { name: 'Pilot seat' }));
  cockpit.push(b.add('cockpitSeat', [W * .25, H * .62, L * .16], { name: 'Copilot seat' }));
  const panel = b.add('instrumentPanel', [0, H * .72, L * .24], { name: 'Instrument panel', scale: { x: Math.min(2, W / .92) } });
  cockpit.push(panel);
  if (L < 15) cockpit.push(b.add('canopy', [0, H * .95, L * .2], { name: 'Canopy', scale: { x: W / 1.05 } }));
  const computer = b.add('flightComputer', [0, H * .5, L * .05], { name: 'Flight computer' });
  cockpit.push(computer);
  const servo = b.add('servo', [W * .3, H * .5, L * .02], { name: 'Servo' });
  cockpit.push(servo);
  const receiver = b.add('receiver', [-W * .3, H * .55, -L * .05], { name: 'Receiver' });
  cockpit.push(receiver);

  /* --- fuel system: wing tanks -> strainer -> (pump) -> engines --- */
  const tankL = b.add('fuelTank', [-half * .35, wingY + .1, 0], { name: 'Port tank' });
  const tankR = b.add('fuelTank', [half * .35, wingY + .1, 0], { name: 'Starboard tank' });
  const strainer = b.add('fuelStrainer', [0, H * .3, L * .1], { name: 'Fuel strainer (low point)' });
  const pump = cfg.wingPlacement === 'high' && !jet ? null : b.add('fuelPump', [0, H * .32, L * .18], { name: 'Boost pump' });
  b.wire(tankL, strainer, 'fuel'); b.wire(tankR, strainer, 'fuel');
  const fuelTo = pump || strainer;
  for (const e of engines) b.wire(fuelTo, e, 'fuel');

  /* --- electrics: battery + alternator -> bus -> breaker -> loads --- */
  const battery = b.add('battery', [0, H * .3, L * .22], { name: 'Battery' });
  const bus = b.add('powerBus', [0, H * .34, L * .18], { name: 'Main bus' });
  const cb = b.add('circuitBreaker', [W * .12, H * .34, L * .14], { name: 'Breaker panel' });
  const alternator = engines.length
    ? b.add('alternator', [engines[0].position.x, engines[0].position.y + .2, engines[0].position.z - .4], { name: 'Alternator' })
    : null;
  b.wire(battery, bus, 'power'); b.wire(battery, bus, 'ground');
  if (alternator) { b.wire(alternator, bus, 'power'); b.wire(alternator, bus, 'ground'); }
  b.wire(bus, cb, 'power'); b.wire(bus, cb, 'ground');

  /* --- hydraulics (heavies): pump -> reservoir -> actuators, own circuit --- */
  let hydPump = null;
  if (heavy) {
    hydPump = b.add('hydraulicPump', [W * .3, H * .35, -L * .1], { name: 'Hydraulic pump' });
    const hydRes = b.add('hydraulicReservoir', [W * .3, H * .45, -L * .15], { name: 'Hydraulic reservoir' });
    const act1 = b.add('hydraulicActuator', [-W * .8, H * .28, L * .04], { name: 'Gear actuator (port main)' });
    const act2 = b.add('hydraulicActuator', [W * .8, H * .28, L * .04], { name: 'Gear actuator (stbd main)' });
    b.wire(hydPump, hydRes, 'hydraulic'); b.wire(hydRes, act1, 'hydraulic'); b.wire(hydRes, act2, 'hydraulic');
    b.wire(act1, hydPump, 'hydraulic'); b.wire(act2, hydPump, 'hydraulic'); // return lines
    b.wire(cb, hydPump, 'power'); b.wire(bus, hydPump, 'ground');
  }

  /* --- lights: port red, starboard green, aft white; strobes wingtips+tail;
         beacon top and bottom; landing lights on the wing --- */
  const tipX = isDelta ? half * .9 : half;
  const navL = b.add('navLight', [-tipX, wingY + .06, 0], { name: 'Nav light (port, red)', color: '#ff2d2d' });
  const navR = b.add('navLight', [tipX, wingY + .06, 0], { name: 'Nav light (stbd, green)', color: '#2dff5a' });
  const navT = b.add('navLight', [0, fin.position.y, -L * .44], { name: 'Nav light (tail, white)', color: '#ffffff' });
  const strobeL = b.add('strobeLight', [-tipX * .98, wingY + .06, .05], { name: 'Strobe (port wingtip)' });
  const strobeR = b.add('strobeLight', [tipX * .98, wingY + .06, .05], { name: 'Strobe (stbd wingtip)' });
  const strobeT = b.add('strobeLight', [0, fin.position.y + .1, -L * .44], { name: 'Strobe (tailcone)' });
  const beaconTop = b.add('beaconLight', [0, H + cfg.height * .25, -L * .38], { name: 'Beacon (top)' });
  const beaconBot = b.add('beaconLight', [0, H * .18, -L * .3], { name: 'Beacon (bottom)' });
  const landL = b.add('landingLight', [-half * .3, wingY - .04, L * .1], { name: 'Landing light (port)' });
  const landR = b.add('landingLight', [half * .3, wingY - .04, L * .1], { name: 'Landing light (stbd)' });
  const lightParts = [navL, navR, navT, strobeL, strobeR, strobeT, beaconTop, beaconBot, landL, landR];
  for (const lp of lightParts) { b.wire(cb, lp, 'power'); b.wire(bus, lp, 'ground'); }
  // jet engines have FADEC electronics: they need the main power circuit + ground return
  for (const e of engines) if (jet) { b.wire(cb, e, 'power'); b.wire(bus, e, 'ground'); }
  // powered loads: panel, computer, pump; 5V devices (servo, receiver) feed from the computer rail
  b.wire(cb, panel, 'power'); b.wire(cb, computer, 'power');
  b.wire(bus, panel, 'ground');
  b.wire(computer, servo, 'power'); b.wire(computer, servo, 'signal');
  b.wire(computer, receiver, 'power'); b.wire(computer, receiver, 'signal');
  // ground-return network: every powered component needs a path back to the battery negative
  b.wire(bus, computer, 'ground');
  b.wire(computer, servo, 'ground'); b.wire(computer, receiver, 'ground');
  if (pump) { b.wire(cb, pump, 'power'); b.wire(bus, pump, 'ground'); }

  /* --- named groups --- */
  b.group('Structure', [body, nose, tailCone, ...(wingL && wingR ? [wingL, wingR] : []), elevL, elevR, fin]);
  b.group('Cockpit', cockpit);
  b.group('Engines', engines);
  b.group('Landing gear', gear);
  b.group('Fuel system', [tankL, tankR, strainer, ...(pump ? [pump] : [])]);
  b.group('Electrics', [battery, bus, cb, ...(alternator ? [alternator] : [])]);
  if (hydPump) b.group('Hydraulics', partsOf(b, /Hydraulic|Gear actuator/));
  b.group('Lights', lightParts);

  return {
    name: cfg.name,
    symmetryEnabled: true, snapIncrement: .25,
    parts: b.parts.map(p => ({ ...p, rotationY: p.rotation.y })),
    wires: b.wires, groups: b.groups
  };
}
function partsOf(b, re) {
  return b.parts.filter(p => re.test(p.name));
}

/* ---------- client-style validation (mirrors validateDesign) ---------- */
function validate(snap) {
  if (snap.parts.length > 600) throw new Error('too many parts');
  const ids = new Set();
  const pairs = new Map();
  for (const [i, p] of snap.parts.entries()) {
    if (!CATALOG.has(p.type)) throw new Error(`unknown component at ${i + 1}`);
    if (!/^part-\d+$/.test(p.id) || ids.has(p.id)) throw new Error('bad id ' + p.id);
    ids.add(p.id);
    for (const axis of ['x', 'y', 'z']) {
      const n = p.position[axis];
      if (!Number.isFinite(n) || Math.abs(n) > 500) throw new Error(`bad ${p.type} position`);
      const s = p.scale[axis];
      if (!Number.isFinite(s) || s < .1 || s > 20) throw new Error(`bad ${p.type} scale`);
    }
    if (p.symmetryPairId) {
      if (!/^mirror-\d+$/.test(p.symmetryPairId)) throw new Error('bad pair id');
      pairs.set(p.symmetryPairId, (pairs.get(p.symmetryPairId) || 0) + 1);
    }
  }
  for (const c of pairs.values()) if (c !== 2) throw new Error('unbalanced symmetry pair');
  const seen = new Set();
  if (snap.wires.length > 2400) throw new Error('too many wires');
  for (const w of snap.wires) {
    if (!ids.has(w.from) || !ids.has(w.to) || w.from === w.to) throw new Error('bad wire endpoints');
    if (!['power', 'signal', 'data', 'ground', 'hydraulic', 'fuel', 'water'].includes(w.kind)) throw new Error('bad wire kind');
    const key = [w.from, w.to].sort().join(':') + ':' + w.kind;
    if (seen.has(key)) throw new Error('duplicate wire ' + key);
    seen.add(key);
  }
  for (const g of snap.groups) for (const id of g.parts) if (!ids.has(id)) throw new Error('group dangling part');
}

/* ---------- main (CLI only, not on import) ---------- */
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const apiIdx = args.indexOf('--api');

function buildAll() {
  const designs = [];
  for (const cfg of Object.values(AIRCRAFT_FLEET)) {
    const snap = designFor(cfg);
    snap.format = 'FlightWorldWorkshop'; snap.version = 2;
    validate(snap); // throws on the first invalid design
    designs.push({ name: cfg.name, kind: 'preset', data: { schema: 'flightworld-build', version: 1, name: cfg.name, build: snap } });
  }
  return designs;
}

if (isCli) {
  const designs = buildAll();
  console.log(`Built ${designs.length} workshop presets from AIRCRAFT_FLEET (all validated).`);

  if (outIdx !== -1) {
    const out = path.resolve(ROOT, args[outIdx + 1]);
    fs.writeFileSync(out, JSON.stringify(designs, null, 1));
    console.log('Wrote', out, `(${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  }
  if (apiIdx !== -1) {
    const base = args[apiIdx + 1].replace(/\/$/, '');
    for (const d of designs) {
      const res = await fetch(base + '/api/builds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
      });
      const j = await res.json().catch(() => ({}));
      console.log(res.status === 201 ? `✓ ${d.name}` : `✗ ${d.name}: ${res.status} ${j.error || ''}`);
    }
  }
  if (outIdx === -1 && apiIdx === -1) console.log('Use --out <file> and/or --api <url> to write the preset pack / seed a server.');
}
export { designFor, validate, buildAll };
