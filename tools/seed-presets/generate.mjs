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
  const wire = (a, b, kind, waypoints = null) => {
    const w = { from: a.id, to: b.id, kind };
    if (waypoints) w.waypoints = waypoints.map(([x, y, z]) => ({ x: round(x), y: round(y), z: round(z) }));
    wires.push(w);
  };
  /* routedWire — a -> b as a structure-following polyline: belly (under the cabin
     floor) when both ends sit low / aft of the cockpit, straight otherwise.
     Real GA fuel lines run under the floor and climb ahead of the firewall
     (systems-research.md §1); a straight tank->engine line would cut through the
     cockpit and fail the audit. max 8 waypoints per wire (validateDesign cap). */
  const routedWire = (a, b, kind) => {
    const zFwd = Math.max(a.position.z, b.position.z);   // forward end of run
    const zAft = Math.min(a.position.z, b.position.z);   // aft end of run
    const yLow = Math.min(a.position.y, b.position.y) - .35;
    const yBelly = Math.max(.12, yLow);                  // under the cabin floor
    const zStart = Math.min(zAft + .25, zFwd - .1);
    const zEnd = Math.max(zAft + .35, zFwd - .2);
    const belly = [
      [a.position.x * .4, yBelly, zStart],
      [0, yBelly, (zStart + zEnd) / 2],
      [b.position.x * .4, yBelly, zEnd]
    ];
    wire(a, b, kind, belly);
  };
  const group = (name, list) => groups.push({
    id: 'grp-' + (groups.length + 1), name, parts: list.map(p => p.id)
  });
  const byId = () => new Map(parts.map(p => [p.id, p]));
  return { parts, wires, groups, add, mirror, wire, routedWire, group, byId };
}
const round = n => Math.round(n * 1000) / 1000;

/* ---------- per-aircraft design ---------- *
 * Coordinates follow the client: X right (port is -X), Y up, Z forward.
 * Wings sit along X, tail at -Z. All dims in metres from the fleet table. */
function designFor(cfg) {
  const b = makeBuilder();
  const L = cfg.length, W = cfg.bodyWidth, H = cfg.bodyHeight;
  const half = cfg.wingspan / 2;
  const isDelta = /delta/i.test(cfg.role) || cfg.id === 'concorde';
  const jet = ['jet', 'supersonic', 'fighter'].includes(cfg.engineType);
  // low-wing piston twins: the wing must sit high enough that the nacelles
  // (lifted for prop ground-clearance) still overlap the wing slab — otherwise
  // the engines break off at flight start (DA42 lesson)
  const pistonMulti = !jet && cfg.engineCount > 1;
  const wingY = cfg.wingPlacement === 'high' ? H * .78 : (pistonMulti ? Math.max(H * .18, .55) : H * .18);
  // delta designs carry everything on the delta slab itself (y = H·.42)
  const surfY = isDelta ? H * .42 : wingY;
  const isGlider = cfg.engineType === 'glider' || cfg.engineCount === 0;
  const heavy = (cfg.massKg || 0) > 8000;

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
  b.add('rudder', [0, H + cfg.height * .18, -L * .4], { name: 'Rudder' });

  /* --- propulsion --- */
  const engines = [];
  const engineType = jet ? 'jetEngine' : 'pistonEngine';
  // jet thrust scales with nacelle scale (x·y) in the flight model, so bigger
  // aircraft get proportionally bigger engines: real airliners run T/W ≈ 0.25–0.3
  const jetScale = jet ? Math.min(3, 1 + Math.max(0, (cfg.massKg || 0) - 5000) / 40000 * 2) : 1;
  if (cfg.engineCount === 1 && !isGlider) {
    const propR = cfg.propBlades >= 4 ? .9 : .775; // prop2/prop4 disk radius
    const e = b.add(engineType, jet ? [0, H * .45, -L * .36] : [0, Math.max(H * .55, propR + .15), L * .4], { name: 'Engine', ...(jet ? { scale: { x: jetScale, y: jetScale, z: Math.min(2.5, jetScale * .8) } } : {}) });
    engines.push(e);
    if (!jet) b.add(cfg.propBlades >= 4 ? 'prop4' : 'prop2', [e.position.x, e.position.y, e.position.z + .44], { name: 'Propeller' });
  } else if (cfg.engineCount > 1) {
    const n = cfg.engineCount;
    const propR = cfg.propBlades >= 4 ? .9 : .775;
    // keep the prop disk and the scaled nacelles clear of the ground plane (y=0)
    const engineY = isDelta ? H * .42 : (jet ? Math.max(wingY - .1, .36 * jetScale + .3) : (cfg.engineCount > 1 ? wingY + .1 : Math.max(wingY - .1, propR + .15)));
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2);
      const x = side * (half * (.45 + rank * .25));
      const e = b.add(engineType, [x, engineY, jet ? .9 : .6], { name: 'Engine ' + (i + 1), ...(jet ? { scale: { x: jetScale, y: jetScale, z: Math.min(2.5, jetScale * .8) } } : {}) });
      engines.push(e);
      if (!jet) b.add(cfg.propBlades >= 4 ? 'prop4' : 'prop2', [x, e.position.y, e.position.z + .44], { name: 'Propeller ' + (i + 1) });
    }
  }

  /* --- landing gear: wheels hang BELOW the fuselage (their bottoms dip under
         y=0 where the belly sits) so the build rolls on its wheels --- */
  const gear = [];
  const wheelY = .2; // wheel half-height ~.36 at scale 1 → bottom ≈ −0.16, below the belly
  for (const x of [-W * .8, W * .8]) {
    const s = b.add('gearStrut', [x, .55, L * .04], { name: 'Main strut', scale: { y: 1.1 } });
    const w = b.add('wheel', [x, wheelY, L * .04], { name: 'Main wheel' });
    gear.push(s, w);
  }
  const ns = b.add('gearStrut', [0, .5, L * .3], { name: 'Nose strut', scale: { y: .9 } });
  const nw = b.add('wheel', [0, .15, L * .3], { name: 'Nose wheel', scale: { x: .7, y: .7, z: .7 } });
  gear.push(ns, nw);

  /* --- cockpit: NEVER a single block — a group of many small parts:
         floor, side walls, roof, rear bulkhead, glazing, seats, panel and
         electronics, all grouped under "Cockpit" --- */
  const cockpit = [];
  const cz0 = L * .05, cz1 = L * .32;                 // cockpit z range
  const czMid = (cz0 + cz1) / 2, ckLen = cz1 - cz0;
  const chY = Math.max(.35, H * .42);                 // cockpit floor height
  // cabin height — clamped so the cockpit (roof included) stays INSIDE the
  // fuselage block: a roof poking out the top is a floating part at flight time
  const chH = Math.min(1.35, Math.max(.8, H * .55), (H - chY) * .8);  // cabin height
  cockpit.push(b.add('skinPanel', [0, chY, czMid], { name: 'Cockpit floor', scale: { x: Math.min(6, W * 1.15 / 1.2), y: 1, z: Math.min(8, ckLen / .72) } }));
  for (const side of [-1, 1])
    cockpit.push(b.add('skinPanel', [side * W * .55, chY + chH / 2, czMid], { name: side < 0 ? 'Cockpit wall (port)' : 'Cockpit wall (stbd)', rotation: { z: Math.PI / 2 }, scale: { x: Math.min(3, chH / 1.2), y: 1, z: Math.min(8, ckLen / .72) } }));
  cockpit.push(b.add('skinPanel', [0, chY + chH, czMid], { name: 'Cockpit roof', scale: { x: Math.min(6, W * 1.15 / 1.2), y: 1, z: Math.min(8, ckLen * .85 / .72) } }));
  cockpit.push(b.add('bulkhead', [0, chY + chH / 2, cz0], { name: 'Cockpit rear bulkhead', scale: { x: Math.min(5, W * 1.0), y: Math.min(3, chH / .85), z: 1 } }));
  if (L < 15) cockpit.push(b.add('canopy', [0, chY + chH + .18, L * .22], { name: 'Windshield / canopy', scale: { x: Math.min(3, W / 1.05) } }));
  cockpit.push(b.add('cockpitSeat', [-W * .25, chY + .25, L * .18], { name: 'Pilot seat' }));
  cockpit.push(b.add('cockpitSeat', [W * .25, chY + .25, L * .18], { name: 'Copilot seat' }));
  const panel = b.add('instrumentPanel', [0, chY + chH * .55, L * .22], { name: 'Instrument panel', scale: { x: Math.min(2, W / .92) } });
  cockpit.push(panel);
  const computer = b.add('flightComputer', [0, chY + .18, L * .08], { name: 'Flight computer' });
  cockpit.push(computer);
  const servo = b.add('servo', [W * .3, chY + .2, L * .07], { name: 'Servo' });
  cockpit.push(servo);
  const receiver = b.add('receiver', [-W * .3, chY + .25, -L * .02], { name: 'Receiver' });
  cockpit.push(receiver);

  /* --- fuel system: wing tanks -> strainer -> (pump) -> engines.
         Gliders have no engines — no fuel system at all. --- */
  let tankL = null, tankR = null, strainer = null, pump = null;
  if (engines.length) {
  tankL = b.add('fuelTank', [-half * .35, surfY, 0], { name: 'Port tank' });
  tankR = b.add('fuelTank', [half * .35, surfY, 0], { name: 'Starboard tank' });
  // gascolator + boost pump: strainer embedded low INSIDE the aft fuselage,
  // pump embedded low inside the forward fuselage — the fuel line runs under the
  // cabin floor and climbs to the engine ahead of the firewall (real GA routing),
  // and both parts physically overlap the fuselage block so they can never
  // detach as floating fragments at flight start
  strainer = b.add('fuelStrainer', [-W * .25, .18, -L * .05], { name: 'Fuel strainer (belly, aft)' });
  pump = b.add('fuelPump', [0, .3, Math.min(L * .27 + .4, L * .31 - .05)], { name: 'Boost pump (under floor, fwd)' });
  b.routedWire(tankL, strainer, 'fuel'); b.routedWire(tankR, strainer, 'fuel');
  if (pump) b.routedWire(strainer, pump, 'fuel');
  const fuelTo = pump || strainer;
  for (const e of engines) b.routedWire(fuelTo, e, 'fuel');
  }

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
    const act1 = b.add('hydraulicActuator', [-W * .35, H * .28, L * .04], { name: 'Gear actuator (port main)' });
    const act2 = b.add('hydraulicActuator', [W * .35, H * .28, L * .04], { name: 'Gear actuator (stbd main)' });
    b.wire(hydPump, hydRes, 'hydraulic'); b.wire(hydRes, act1, 'hydraulic'); b.wire(hydRes, act2, 'hydraulic');
    b.wire(act1, hydPump, 'hydraulic'); b.wire(act2, hydPump, 'hydraulic'); // return lines
    b.wire(cb, hydPump, 'power'); b.wire(bus, hydPump, 'ground');
  }

  /* --- lights: port red, starboard green, aft white; strobes wingtips+tail;
         beacon top and bottom; landing lights on the wing --- */
  const tipX = isDelta ? half * .9 : half;
  const navL = b.add('navLight', [-tipX, surfY + .06, 0], { name: 'Nav light (port, red)', color: '#ff2d2d' });
  const navR = b.add('navLight', [tipX, surfY + .06, 0], { name: 'Nav light (stbd, green)', color: '#2dff5a' });
  const navT = b.add('navLight', [0, fin.position.y, -L * .44], { name: 'Nav light (tail, white)', color: '#ffffff' });
  const strobeL = b.add('strobeLight', [-tipX * .98, surfY + .06, .05], { name: 'Strobe (port wingtip)' });
  const strobeR = b.add('strobeLight', [tipX * .98, surfY + .06, .05], { name: 'Strobe (stbd wingtip)' });
  const strobeT = b.add('strobeLight', [0, fin.position.y + .1, -L * .44], { name: 'Strobe (tailcone)' });
  const beaconTop = b.add('beaconLight', [0, H * .8, -L * .38], { name: 'Beacon (top)' });
  const beaconBot = b.add('beaconLight', [0, H * .18, -L * .3], { name: 'Beacon (bottom)' });
  // landing lights half-embedded in the fuselage sides (wing-root region):
  // the inner half overlaps the block (flight-time attachment), the outer
  // half protrudes so the light is visible and can illuminate
  const landL = b.add('landingLight', [-W * .5, H * .5, L * .15], { name: 'Landing light (port)' });
  const landR = b.add('landingLight', [W * .5, H * .5, L * .15], { name: 'Landing light (stbd)' });
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
  if (engines.length) b.group('Fuel system', [tankL, tankR, strainer, ...(pump ? [pump] : [])]);
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

/* preliminary contact check: every part's raw catalog box must overlap
   another part's box. This is an APPROXIMATION of the flight-time rule
   (RAPIER convex-hull contact within 25 mm) — box overlap does NOT strictly
   guarantee hull contact for tapered geometry (cones), so the runtime
   pipeline is the final arbiter; treat a pass here as necessary, not
   sufficient. A part failing this certainly breaks off at flight start. */
function contactOk(snap, catalog) {
  const bad = [];
  for (const p of snap.parts) {
    const d = catalog[p.type];
    const s = p.scale || { x: 1, y: 1, z: 1 };
    const size = (d && d.size) || [0.5, 0.5, 0.5];
    const c = p.position;
    const ry = (p.rotation && p.rotation.y) || 0;
    let hx = size[0] * (s.x || 1) / 2, hz = size[2] * (s.z || 1) / 2;
    if (Math.abs(Math.abs(ry) - Math.PI / 2) < 0.01) { const t = hx; hx = hz; hz = t; }
    p._box = { minX: c.x - hx, maxX: c.x + hx, minY: c.y - size[1] * (s.y || 1) / 2, maxY: c.y + size[1] * (s.y || 1) / 2, minZ: c.z - hz, maxZ: c.z + hz };
  }
  const inter = (a, b) => !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY || a.maxZ <= b.minZ || b.maxZ <= a.minZ);
  for (const p of snap.parts) {
    if (!snap.parts.some(q => q !== p && inter(p._box, q._box))) bad.push(p.name);
  }
  for (const p of snap.parts) delete p._box;
  return bad;
}

/* prop pairing: every non-jet engine needs a prop within the client's shaft
   window (axial in [-0.025, propDepth/2+0.10], radial <= 0.035, same axis) or
   AeroCore.propulsion drops the engine ("fit a propeller to the forward
   shaft") and the design gets zero thrust. Simplified for unrotated parts. */
function propPairingOk(snap, catalog) {
  const bad = [];
  const props = snap.parts.filter(p => catalog[p.type] && catalog[p.type].propBlades);
  for (const e of snap.parts) {
    const d = catalog[e.type];
    if (!d || !d.engineType || ['jet', 'rocket'].includes(d.engineType)) continue;
    const es = e.scale || { x: 1, y: 1, z: 1 };
    const shaftZ = e.position.z + (d.size[2] / 2) * (es.z || 1);
    const ok = props.some(p => {
      const axial = p.position.z - shaftZ;
      const radial = Math.hypot(p.position.x - e.position.x, p.position.y - e.position.y);
      const depth = catalog[p.type].size[2] * ((p.scale || {}).z || 1);
      return axial >= -0.025 && axial <= depth / 2 + 0.10 && radial <= 0.035 * Math.max(es.x, es.y);
    });
    if (!ok) bad.push(e.name + ' (no prop in shaft window)');
  }
  return bad;
}

/* ---------- client-style validation (mirrors validateDesign) ---------- */
// replicate the client's cockpit-clearance rule: no fuel segment may cross the
// crewed zone (bounding box of seats/panel/canopy/cabin, expanded 0.35 m)
function cockpitClearOk(snap) {
  const parts = snap.parts;
  const boxParts = parts.filter(p => ['cockpitSeat', 'instrumentPanel', 'canopy', 'cabinBlock'].includes(p.type));
  if (!boxParts.length) return true;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of boxParts) for (const a of ['x', 'y', 'z']) {
    const v = p.position[a];
    if (a === 'x') { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
    if (a === 'y') { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
    if (a === 'z') { minZ = Math.min(minZ, v); maxZ = Math.max(maxZ, v); }
  }
  minX -= .35; minY -= .35; minZ -= .35; maxX += .35; maxY += .35; maxZ += .35;
  // exact slab intersection on the cockpit box — matches the client audit's
  // workshopWirePath geometry: part endpoints lifted 0.1 m above part centre,
  // waypoints as given, straight segments between them, no sampling gaps
  const byId = new Map(parts.map(p => [p.id, p]));
  const box = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };
  const segHitsBox = (P, Q) => {
    const d = { x: Q.x - P.x, y: Q.y - P.y, z: Q.z - P.z };
    let t0 = 0, t1 = 1;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(d[ax]) < 1e-9) {
        if (P[ax] < box[ax][0] || P[ax] > box[ax][1]) return false;
      } else {
        let ta = (box[ax][0] - P[ax]) / d[ax], tb = (box[ax][1] - P[ax]) / d[ax];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
    }
    return true;
  };
  for (const w of snap.wires) {
    if (w.kind !== 'fuel') continue;
    const a = byId.get(w.from), b = byId.get(w.to);
    if (!a || !b) continue;
    // endpoints lifted 0.1 m above part centre — exactly what workshopWirePath()
    // resolves on the client, so the generator and the client audit agree
    const lift = p => ({ ...p, y: p.y + .1 });
    const pts = [lift(a.position), ...(w.waypoints || []).map(p => ({ ...p })), lift(b.position)];
    for (let s = 0; s < pts.length - 1; s++) {
      if (segHitsBox(pts[s], pts[s + 1]))
        return `${a.name} → ${b.name} crosses the cockpit box`;
    }
  }
  return true;
}
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
  const clear = cockpitClearOk(snap);
  if (clear !== true) throw new Error('fuel routing: ' + clear);
  const loose = contactOk(snap, WORKSHOP_PARTS);
  if (loose.length) throw new Error('floating parts (no physical contact): ' + loose.join(', '));
  const unpaired = propPairingOk(snap, WORKSHOP_PARTS);
  if (unpaired.length) throw new Error('engines without a shaft-window prop: ' + unpaired.join(', '));
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
    try { validate(snap); } catch (e) { throw new Error('[' + cfg.name + '] ' + e.message); } // throws on the first invalid design
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
