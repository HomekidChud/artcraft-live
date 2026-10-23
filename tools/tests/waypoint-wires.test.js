import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

/* Wire waypoint routing regression — the client functions under test are
 * extracted verbatim from the single-file client (airplanecraft/index.html),
 * so the tests exercise the production code, not a copy. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = path.join(ROOT, 'airplanecraft', 'index.html');
const PRESETS = path.join(ROOT, 'airplanecraft', 'presets-fleet.json');

function clientModule() {
  const html = fs.readFileSync(CLIENT, 'utf8');
  const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  // client module parses as a JS module (node --check with TLA support)
  const tmp = path.join(os.tmpdir(), 'fw_client_check.mjs');
  fs.writeFileSync(tmp, body);
  const r = spawnSync(process.execPath, ['--check', tmp]);
  assert.equal(r.status, 0, 'client module syntax error: ' + r.stderr);
  return body;
}

function extract(body, header) {
  let i = body.indexOf(header);
  if (i < 0) throw new Error('missing ' + header);
  let j = i;
  while (true) {
    j = body.indexOf('\n', j + 1);
    const line = body.slice(j + 1, body.indexOf('\n', j + 1));
    if (line.startsWith('function ') || line.startsWith('const ')) break;
  }
  const src = body.slice(i, j);
  return src.slice(0, src.lastIndexOf('}') + 1);
}

test('client module parses', () => { clientModule(); });

const body = clientModule();
// module-scope editor state: the extracted client functions read AND write these,
// and strict-mode eval cannot assign to undeclared identifiers
let workshopSelectedId = null;
let workshopSelectedWire = null;
let workshopWireSims = [];
let workshopSparkBurst = null;
let workshopBonds = [];
let workshopGlueRoot = null;
let workshopGlueStart = null;
let WORKSHOP_WIRE_STIFFNESS = {}; // eval'd in the sag test
let workshopMultiSelect = new Set();
const validateSrc = extract(body, 'function validateDesign(input, catalog) {');
const pathSrc = extract(body, 'function workshopWirePath(w){');
const auditSrc = extract(body, 'function workshopSystemsAudit(){');

/* validateDesign: production function with only its real deps (input, catalog) */
const catMatch = body.match(/const WORKSHOP_PARTS=\{([\s\S]*?)\n\};/);
fs.writeFileSync('/tmp/fw_catalog.mjs', 'export const WORKSHOP_PARTS={' + catMatch[1] + '\n};\n');
const { WORKSHOP_PARTS } = await import('file:///tmp/fw_catalog.mjs');
const vd = (input) => eval('(' + validateSrc + ')')(input, WORKSHOP_PARTS);

const mkPart = (id, type, pos) => ({ id, type, position: pos, scale: { x: 1, y: 1, z: 1 } });

test('validateDesign accepts optional waypoints and normalises them', () => {
  const snap = { parts: [mkPart('part-1', 'fuelTank', { x: 0, y: 0, z: 0 }), mkPart('part-2', 'fuelPump', { x: 0, y: 0, z: 5 })],
    wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: 0.1, z: 2 }] }] };
  const r = vd(snap);
  assert.deepEqual(r.wires[0].waypoints, [{ x: 0, y: 0.1, z: 2 }]);
});

test('validateDesign rejects malformed waypoints', () => {
  const base = { parts: [mkPart('part-1', 'fuelTank', { x: 0, y: 0, z: 0 }), mkPart('part-2', 'fuelPump', { x: 0, y: 0, z: 5 })] };
  assert.throws(() => vd({ ...base, wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: 'belly' }] }), /waypoints/);
  assert.throws(() => vd({ ...base, wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: Array.from({ length: 9 }, (_, i) => ({ x: i, y: 0, z: 0 })) }] }), /8 waypoints/);
  assert.throws(() => vd({ ...base, wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: 9999, z: 0 }] }] }), /waypoint/);
  assert.throws(() => vd({ ...base, wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: 0 }] }] }), /waypoint/);
});

test('validateDesign: repeated independent calls, no shared state', () => {
  for (let n = 0; n < 3; n++) {
    const r = vd({ parts: [mkPart('part-1', 'fuelTank', { x: 0, y: 0, z: 0 }), mkPart('part-2', 'fuelPump', { x: 0, y: 0, z: 5 })],
      wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel' }] });
    assert.equal(r.wires.length, 1);
  }
});

test('workshopWirePath resolves straight (2 pts) and routed (2 + waypoints)', () => {
  globalThis.THREE = { Vector3: class V { constructor(x, y, z) { Object.assign(this, { x, y, z }); }
      clone() { return new V(this.x, this.y, this.z); }
      add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
      multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
      distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } } };
  const mk = (id, pos) => ({ userData: { partId: id }, position: new THREE.Vector3(...pos) });
  globalThis.workshopGetPart = id => mk(id, [0, 2, 5]);
  let wpFn; eval(pathSrc.replace('function workshopWirePath', 'wpFn = function workshopWirePath'));
  assert.equal(wpFn({ from: 'a', to: 'b', kind: 'fuel' }).length, 2);
  const routed = wpFn({ from: 'a', to: 'b', kind: 'fuel', waypoints: [{ x: 0, y: .12, z: 1 }, { x: 0, y: .12, z: 4 }] });
  assert.equal(routed.length, 4);
  assert.equal(routed[1].y, .12);
});

test('audit catches a straight fuel line through the cockpit, passes a belly run', () => {
  globalThis.THREE = { Vector3: THREE.Vector3, Box3: class B { constructor() { this.min = new THREE.Vector3(Infinity, Infinity, Infinity); this.max = new THREE.Vector3(-Infinity, -Infinity, -Infinity); }
      expandByPoint(p) { for (const a of ['x', 'y', 'z']) { this.min[a] = Math.min(this.min[a], p[a]); this.max[a] = Math.max(this.max[a], p[a]); } return this; }
      expandByScalar(k) { for (const a of ['x', 'y', 'z']) { this.min[a] -= k; this.max[a] += k; } return this; }
      containsPoint(p) { return ['x', 'y', 'z'].every(a => p[a] >= this.min[a] && p[a] <= this.max[a]); } } };
  const P = (id, type, pos) => ({ userData: { partId: id, type }, position: new THREE.Vector3(...pos) });
  const parts = [P('tank', 'fuelTank', [0, 1, -6]), P('eng', 'engine', [0, 1, 6]), P('seat', 'cockpitSeat', [0, 1, 0]), P('panel', 'instrumentPanel', [0, 1.4, 1])];
  globalThis.workshopParts = parts;
  globalThis.workshopGetPart = id => parts.find(p => p.userData.partId === id) || null;
  globalThis.workshopRenderInspector = () => {};
  eval(pathSrc.replace('function workshopWirePath', 'globalThis.workshopWirePath = function workshopWirePath'));
  let audit; eval(auditSrc.replace('function workshopSystemsAudit', 'audit = function workshopSystemsAudit'));

  // straight line tank -> engine passes through the cockpit
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'fuel' }];
  assert.ok(audit().errors.some(e => /cockpit/.test(e)));

  // belly-routed polyline goes under the floor — clean
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'fuel', waypoints: [{ x: 0, y: 0.12, z: -2 }, { x: 0, y: 0.12, z: 2 }] }];
  assert.equal(audit().errors.length, 0);

  // hydraulic lines are held to the same structure-following rule as fuel
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'hydraulic' }];
  const hydStraight = audit().errors;
  assert.ok(hydStraight.some(e => /Hydraulic line.*cockpit/.test(e)), 'hydraulic through cockpit not caught: ' + JSON.stringify(hydStraight));
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'hydraulic', waypoints: [{ x: 0, y: 0.12, z: -2 }, { x: 0, y: 0.12, z: 2 }] }];
  const hydRouted = audit().errors;
  assert.ok(!hydRouted.some(e => /cockpit/.test(e)), 'routed hydraulic flagged: ' + JSON.stringify(hydRouted));

  // long segment that only clips a thin sliver of the box: with the old
  // 13-point sampler a short chord near a corner could fall between samples;
  // the exact slab intersection cannot miss it.
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'fuel', waypoints: [{ x: 2, y: 1.2, z: -2 }, { x: -2, y: 1.2, z: 2 }] }];
  const clipped = audit().errors;
  assert.ok(clipped.some(e => /cockpit/.test(e)), 'diagonal pass-through not caught: ' + JSON.stringify(clipped));

  // regression that motivated the exact check: a long segment whose chord
  // through the box is a short sliver. The old 13-point sampler MISSES it
  // (verified independently); the production audit must CATCH it.
  globalThis.workshopWires = [{ from: 'tank', to: 'eng', kind: 'fuel', waypoints: [{ x: 0, y: 1.2, z: -100 }, { x: 0, y: 1.2, z: 99 }] }];
  const thinSliver = audit().errors;
  assert.ok(thinSliver.some(e => /cockpit/.test(e)), 'thin sliver not caught — sampler regression: ' + JSON.stringify(thinSliver));
});

test('all 24 presets pass client validateDesign with routed wires preserved', () => {
  const pack = JSON.parse(fs.readFileSync(PRESETS, 'utf8'));
  let routed = 0;
  for (const d of pack) {
    const r = vd(d.data.build);
    routed += r.wires.filter(w => w.waypoints).length;
  }
  assert.equal(pack.length, 24);
  assert.ok(routed > 0, 'no routed wires in preset pack');
});

test('wire waypoints survive a save -> validate -> restore round-trip (serialization)', () => {
  const snap = { name: 'Test', symmetryEnabled: true, snapIncrement: .25,
    parts: [mkPart('part-1', 'fuelTank', { x: 0, y: 0, z: 0 }), mkPart('part-2', 'fuelPump', { x: 0, y: 0, z: 5 })],
    wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: .12, z: 2.5 }] }] };
  // cloud save serialises the snapshot; reload validates then restores the same object
  const serialised = JSON.parse(JSON.stringify(snap));
  const validated = vd(serialised);
  assert.deepEqual(validated.wires[0].waypoints, [{ x: 0, y: .12, z: 2.5 }]);
  // what restore consumes: workshopRestoreSnapshot does workshopCloneJSON(snap.wires)
  // — deep clone, waypoints preserved through undo/redo and cloud load
  const restored = JSON.parse(JSON.stringify(validated));
  assert.deepEqual(restored.wires[0].waypoints, snap.wires[0].waypoints);
});

test('workshopRestoreSnapshot preserves waypoints through the real restore path', () => {
  // Execute the actual client functions (extracted verbatim) with minimal
  // scene/DOM stubs, as the browser would: snapshot -> restore -> the wire
  // object the editor holds afterwards must still carry its waypoints, and
  // must be a DEEP COPY (mutating the restored wire cannot corrupt the
  // original snapshot, which is what undo/redo relies on).
  const restoreSrc = extract(body, 'function workshopRestoreSnapshot(snap){');
  const cloneSrc = extract(body, 'function workshopCloneJSON(o){');

  // minimal DOM stub: $('id') returns a plain object with value/textContent etc.
  const els = new Map();
  const $ = id => { if (!els.has(id)) els.set(id, { value: '', textContent: '', hidden: false, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, disabled: false }); return els.get(id); };

  // minimal THREE + scene stubs for what restore actually touches
  globalThis.THREE = { Vector3: class V { constructor(x, y, z) { Object.assign(this, { x, y, z }); } clone() { return new V(this.x, this.y, this.z); } } };
  globalThis.workshopBuildRoot = { children: [], remove() {}, clear() {} };
  globalThis.workshopWireRoot = { clear() {} };
  globalThis.workshopGroups = [];
  globalThis.workshopParts = [];
  globalThis.workshopWires = [];
  globalThis.workshopNextId = 1;
  workshopSelectedId = null;
  workshopSelectedWire = null;
  globalThis.workshopNextSymmetryId = 1;
  globalThis.workshopSymmetryEnabled = true;
  globalThis.workshopSnapIncrement = .25;
  globalThis.workshopSelectedId = null;
  globalThis.workshopLoading = false;
  globalThis.workshopCreatePart = () => null;   // parts not under test
  globalThis.workshopGetPart = () => null;
  globalThis.workshopRebuildWires = () => {};   // rendering not under test here
  globalThis.workshopSelectPart = () => {};
  globalThis.workshopUpdateStats = () => {};
  globalThis.workshopUpdateEmptyHint = () => {};
  globalThis.workshopUpdateHistoryButtons = () => {};
  globalThis.$ = $;

  // install the real functions
  let restore; eval(restoreSrc.replace('function workshopRestoreSnapshot', 'restore = function workshopRestoreSnapshot'));
  let clone; eval(cloneSrc.replace('function workshopCloneJSON', 'clone = function workshopCloneJSON'));
  globalThis.workshopCloneJSON = clone;

  const wire = { from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: .12, z: 2.5 }] };
  const snap = { name: 'Test', symmetryEnabled: true, snapIncrement: .25, parts: [], groups: [], wires: [wire] };

  restore(snap);
  assert.equal(globalThis.workshopWires.length, 1);
  assert.deepEqual(globalThis.workshopWires[0].waypoints, [{ x: 0, y: .12, z: 2.5 }], 'waypoints lost through restore');
  // deep-copy independence: mutating the restored wire must not touch the snapshot
  globalThis.workshopWires[0].waypoints[0].y = 9;
  assert.equal(wire.waypoints[0].y, .12, 'restore aliased the snapshot — undo/redo would corrupt history');
});

/* ---------- waypoint editor (selectable wires, draggable waypoints) ---------- */

test('workshopSelectWire: valid index selects and clears part selection; invalid clears', () => {
  const selectSrc = extract(body, 'function workshopSelectWire(i){');
  const fakePart = { userData: { partId: 'part-1' }, position: new THREE.Vector3(0, 0, 0) };
  globalThis.workshopWires = [
    { from: 'part-1', to: 'part-2', kind: 'fuel', waypoints: [{ x: 0, y: .12, z: 1 }] },
    { from: 'part-2', to: 'part-3', kind: 'power' }
  ];
  globalThis.workshopGetPart = () => fakePart;
  workshopSelectedId = 'part-1';
  workshopMultiSelect = new Set(['a', 'b']);
  globalThis.workshopRenderInspector = () => {};
  globalThis.workshopRebuildWires = () => {};
  let sel; eval(selectSrc.replace('function workshopSelectWire', 'sel = function workshopSelectWire'));
  sel(0);
  assert.equal(workshopSelectedWire, 0);
  assert.equal(workshopSelectedId, null, 'selecting a wire must clear the part selection');
  assert.equal(workshopMultiSelect.size, 0, 'selecting a wire must clear multi-select');
  sel(99);   // out of range -> deselect
  assert.equal(workshopSelectedWire, null);
  sel(null); // explicit null
  assert.equal(workshopSelectedWire, null);
});

test('workshopRebuildWireHandles: spheres only for the selected routed wire', () => {
  const handlesSrc = extract(body, 'function workshopRebuildWireHandles(){');
  const V = THREE.Vector3;
  const mkMesh = () => ({ userData: {}, position: new V(0,0,0), geometry: null, material: null });
  const scene = { children: [], add(o){ this.children.push(o); }, remove(o){ this.children = this.children.filter(c => c !== o); } };
  globalThis.THREE = { ...THREE, Group: class { constructor(){ this.children=[]; } add(o){ this.children.push(o); } remove(o){ this.children=this.children.filter(c=>c!==o); } }, Mesh: class { constructor(){ this.userData={}; this.position={ set(){}, x:0, y:0, z:0 }; } }, SphereGeometry: class {}, MeshBasicMaterial: class {} };
  globalThis.workshopScene = scene;
  globalThis.workshopWaypointRoot = null;
  // camera stub for the distance-adaptive handle size (fixed 55 m like the side-view test)
  globalThis.workshopCamera = { position: { distanceTo: () => 55 } };
  globalThis.workshopTarget = new THREE.Vector3(0, 1, 0);
  globalThis.workshopWires = [
    { from: 'a', to: 'b', kind: 'fuel', waypoints: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }] },
    { from: 'b', to: 'c', kind: 'power' }
  ];
  workshopSelectedWire = 0;
  let rebuild; eval(handlesSrc.replace('function workshopRebuildWireHandles', 'rebuild = function workshopRebuildWireHandles'));
  rebuild();
  assert.equal(scene.children.length, 1, 'waypoint root not added to scene');
  const root = scene.children[0];
  assert.equal(root.children.length, 2, 'expected one handle per waypoint');
  assert.deepEqual(root.children[0].userData, { isWaypointHandle: true, wireIndex: 0, wpIndex: 0 });
  assert.deepEqual(root.children[1].userData, { isWaypointHandle: true, wireIndex: 0, wpIndex: 1 });
  // selecting the straight wire (no waypoints) -> no handles
  workshopSelectedWire = 1;
  rebuild();
  assert.equal(root.children.length, 0);
  // no selection -> no handles
  workshopSelectedWire = null;
  rebuild();
  assert.equal(root.children.length, 0);
});

/* ---------- wire physics: gravity/sag (verlet), water arcing, pressure ---------- */

function physicsEnv() {
  // THREE stub good enough for the verlet rope + audit + pressure code paths
  globalThis.THREE = { Vector3: class V {
      constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
      clone(){return new V(this.x,this.y,this.z);}
      copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
      set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
      distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
      distanceToSquared(v){const dx=this.x-v.x,dy=this.y-v.y,dz=this.z-v.z;return dx*dx+dy*dy+dz*dz;}
      static lerpVectors(a,b,t){return new V(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
      lerpVectors(a,b,t){this.x=a.x+(b.x-a.x)*t;this.y=a.y+(b.y-a.y)*t;this.z=a.z+(b.z-a.z)*t;return this;}
    } };
  globalThis.workshopScene = { add(){}, children: [] };
  globalThis.workshopWireRoot = { children: [] };
  globalThis.workshopSetNDC = () => {};
  globalThis.workshopGetPart = id => globalThis.__parts.get(id) || null;
  globalThis.workshopSetStatus = () => {};
}

test('wire physics: an unclamped span sags under gravity', () => {
  physicsEnv();
  const stepSrc = extract(body, 'function workshopStepWirePhysics(dt){');
  eval(body.match(/const WORKSHOP_WIRE_STIFFNESS=\{[^}]*\};/)[0].replace('const WORKSHOP_WIRE_STIFFNESS', 'WORKSHOP_WIRE_STIFFNESS'));
  eval(body.match(/const EnergyCore=\{[\s\S]*?\n\};/)[0].replace('const EnergyCore', 'globalThis.EnergyCore'));
  const simSrc = extract(body, 'function workshopRebuildWireSims(){');
  const keySrc = extract(body, 'function workshopWireSimKey(w){');
  const pinsSrc = extract(body, 'function workshopWirePinsFor(w){');

  globalThis.__parts = new Map([
    ['a', { userData: { partId: 'a' }, position: new THREE.Vector3(-3, 2, 0) }],
    ['b', { userData: { partId: 'b' }, position: new THREE.Vector3(3, 2, 0) }]
  ]);
  globalThis.workshopWires = [{ from: 'a', to: 'b', kind: 'power' }];
  globalThis.workshopParts = [...globalThis.__parts.values()];
  let rebuildSims; eval(simSrc.replace('function workshopRebuildWireSims', 'rebuildSims = function workshopRebuildWireSims'));
  let step; eval(stepSrc.replace('function workshopStepWirePhysics', 'step = function workshopStepWirePhysics'));
  eval(keySrc.replace('function workshopWireSimKey', 'globalThis.workshopWireSimKey = function workshopWireSimKey'));
  eval(pinsSrc.replace('function workshopWirePinsFor', 'globalThis.workshopWirePinsFor = function workshopWirePinsFor'));

  rebuildSims();
  const sim = workshopWireSims[0]; // module-scope let, not a globalThis property
  assert.ok(sim, 'sim built');
  const n = sim.pts.length;
  assert.ok(n >= 8, 'expected subdivided nodes, got ' + n);
  // geometry stub the step writes into
  const attr = { setXYZ(){}, needsUpdate: false };
  sim.line = { geometry: { getAttribute: () => attr, computeBoundingSphere(){} } };
  const yBefore = sim.pts[Math.floor(n / 2)].p.y;
  for (let i = 0; i < 120; i++) step(1 / 60); // 2 s of settling
  const yAfter = sim.pts[Math.floor(n / 2)].p.y;
  assert.ok(yAfter < yBefore - 0.01, 'wire did not sag: ' + yBefore + ' -> ' + yAfter);
  // endpoints stay pinned at their parts
  assert.equal(sim.pts[0].p.y, 2.1);
  assert.equal(sim.pts[n - 1].p.y, 2.1);
  // free nodes stay above the floor
  for (const sp of sim.pts) assert.ok(sp.p.y >= 0.03, 'node fell through the floor');
});

test('audit: powered line within 0.5 m of a water line is an arcing fault', () => {
  physicsEnv();
  const auditSrc = extract(body, 'function workshopSystemsAudit(){');
  const P = (id, type, pos) => ({ userData: { partId: id, type }, position: new THREE.Vector3(...pos) });
  // power wire and water wire running side by side, 0.2 m apart
  globalThis.workshopParts = [
    P('p1', 'battery', [0, 1, 0]), P('p2', 'powerBus', [0, 1, 4]),
    P('w1', 'waterTank', [0.2, 1, 0]), P('w2', 'waterPump', [0.2, 1, 4])
  ];
  globalThis.workshopWires = [
    { from: 'p1', to: 'p2', kind: 'power' },
    { from: 'w1', to: 'w2', kind: 'water' }
  ];
  globalThis.__parts = new Map(globalThis.workshopParts.map(p => [p.userData.partId, p])); // workshopGetPart reads this
  globalThis.workshopRenderInspector = () => {};
  let audit; eval(auditSrc.replace('function workshopSystemsAudit', 'audit = function workshopSystemsAudit'));
  const errors = audit().errors;
  assert.ok(errors.some(e => /water line/.test(e)), 'water/power proximity not caught: ' + JSON.stringify(errors));
  // crossing runs whose endpoints are far apart must still be caught (segment-segment, not vertex-vertex)
  globalThis.workshopParts = [
    P('p1', 'battery', [0, 1, 0]), P('p2', 'powerBus', [0, 1, 40]),       // power wire along Z
    P('w1', 'waterTank', [30, 1, 20]), P('w2', 'waterPump', [-30, 1, 20]) // water wire along X, crossing at (0,1,20)
  ];
  globalThis.__parts = new Map(globalThis.workshopParts.map(p => [p.userData.partId, p]));
  const cross = audit().errors;
  assert.ok(cross.some(e => /water line/.test(e)), 'crossing runs not caught: ' + JSON.stringify(cross));
  // separated runs pass
  globalThis.workshopParts = [
    P('p1', 'battery', [0, 1, 0]), P('p2', 'powerBus', [0, 1, 4]),
    P('w1', 'waterTank', [3, 1, 0]), P('w2', 'waterPump', [3, 1, 4])
  ];
  globalThis.__parts = new Map(globalThis.workshopParts.map(p => [p.userData.partId, p]));
  const clean = audit().errors;
  assert.ok(!clean.some(e => /water line/.test(e)), 'separated runs falsely flagged: ' + JSON.stringify(clean));
});

test('pressure: pumps pressurise their own fluid networks only', () => {
  physicsEnv();
  const prSrc = extract(body, 'function workshopSystemPressures(){');
  const P = (id, type, pos) => ({ userData: { partId: id, type }, position: new THREE.Vector3(...pos) });
  globalThis.workshopParts = [
    P('hp', 'hydraulicPump', [0, 1, 0]), P('act', 'gearActuator', [0, 1, 2]),
    P('fp', 'fuelPump', [2, 1, 0]), P('eng', 'engine', [2, 1, 2]),
    P('iso', 'cabinBlock', [5, 1, 0])
  ];
  globalThis.workshopWires = [
    { from: 'hp', to: 'act', kind: 'hydraulic' },
    { from: 'fp', to: 'eng', kind: 'fuel' }
  ];
  let pressures; eval(prSrc.replace('function workshopSystemPressures', 'pressures = function workshopSystemPressures'));
  const pr = pressures();
  assert.deepEqual(pr.act, { hydraulic: 3000 }, 'hydraulic actuator pressure');
  assert.deepEqual(pr.eng, { fuel: 30 }, 'fuel line pressure');
  assert.equal(pr.iso, undefined, 'isolated part must not inherit pressure');
  // a part reachable by BOTH kinds keeps separate readings per fluid (no conflation)
  globalThis.workshopWires = [
    { from: 'hp', to: 'act', kind: 'hydraulic' },
    { from: 'fp', to: 'act', kind: 'fuel' } // actuator fed by fuel too (bad design, but the model must not cross-contaminate)
  ];
  const pr2 = pressures();
  assert.deepEqual(pr2.act, { hydraulic: 3000, fuel: 30 }, 'shared part keeps distinct fuel and hydraulic pressures');
  // a fuel-only part must never display the hydraulic reading
  globalThis.workshopWires = [{ from: 'fp', to: 'act', kind: 'fuel' }];
  const pr3 = pressures();
  assert.deepEqual(pr3.act, { fuel: 30 }, 'fuel-fed part shows fuel pressure only');
});

/* ---------- glue: bond graph, click flow, schema, snapshot roundtrip ---------- */

test('glue: bond graph traversal reaches chained parts, not the start', () => {
  physicsEnv();
  const setSrc = extract(body, 'function workshopBondedSet(partId){');
  let bondedSet; eval(setSrc.replace('function workshopBondedSet', 'bondedSet = function workshopBondedSet'));
  // a—b—c chain plus an isolated d
  workshopBonds = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'd', to: 'e' }];
  assert.deepEqual([...bondedSet('a')].sort(), ['b', 'c']);
  assert.deepEqual([...bondedSet('c')].sort(), ['a', 'b']);
  assert.deepEqual([...bondedSet('d')], ['e']);
  assert.deepEqual([...bondedSet('x')], []);
});

test('glue: click flow creates and removes bonds, pushes undo', () => {
  physicsEnv();
  const glueSrc = extract(body, 'function workshopPartClickForGlue(p){');
  const P = (id) => ({ userData: { partId: id, name: id.toUpperCase() } });
  globalThis.__parts = new Map([['a', P('a')], ['b', P('b')], ['c', P('c')]]);
  globalThis.workshopParts = [];
  workshopBonds = [];
  workshopGlueStart = null;
  const undoStack = [];
  globalThis.workshopPushUndo = () => undoStack.push(workshopSnapshotOf());
  globalThis.workshopRebuildWires = () => {};
  globalThis.workshopRenderInspector = () => {};
  globalThis.workshopUpdateStats = () => {};
  globalThis.workshopSaveDraft = () => {};
  globalThis.workshopSelectPart = () => {};
  globalThis.workshopSetStatus = () => {};
  const workshopSnapshotOf = () => JSON.parse(JSON.stringify(workshopBonds));
  let glue; eval(glueSrc.replace('function workshopPartClickForGlue', 'glue = function workshopPartClickForGlue'));

  glue(P('a'));                       // pick start
  assert.equal(workshopGlueStart, 'a');
  glue(P('b'));                       // glue a—b
  assert.deepEqual(workshopBonds, [{ from: 'a', to: 'b' }]);
  assert.equal(undoStack.length, 1, 'bond creation pushes undo');
  assert.equal(workshopGlueStart, null, 'start resets after bonding');

  glue(P('a')); glue(P('b'));          // click the same pair again → unglue
  assert.deepEqual(workshopBonds, [], 'second click on a glued pair unglues');
  assert.equal(undoStack.length, 2);

  glue(P('a')); glue(P('a'));          // clicking the same part cancels
  assert.equal(workshopGlueStart, null);
  assert.deepEqual(workshopBonds, []);
});

test('schema: bonds validate — valid pass, self/dup/unknown rejected', () => {
  const design = (bonds) => ({
    name: 'Glue test', parts: [
      { id: 'part-1', type: 'fuelTank', position: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { id: 'part-2', type: 'fuelPump', position: { x: 2, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { id: 'part-3', type: 'fuelStrainer', position: { x: 4, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    ], wires: [], bonds
  });
  assert.deepEqual(vd(design([{ from: 'part-1', to: 'part-2' }])).bonds,
    [{ from: 'part-1', to: 'part-2' }]);
  assert.throws(() => vd(design([{ from: 'part-1', to: 'part-1' }])), /Invalid glue bond/);
  assert.throws(() => vd(design([{ from: 'part-1', to: 'nope' }])), /Invalid glue bond/);
  assert.throws(() => vd(design([{ from: 'part-1', to: 'part-2' }, { from: 'part-2', to: 'part-1' }])), /Duplicate glue bond/);
});

test('snapshot: restore carries glue bonds end-to-end', () => {
  physicsEnv();
  const snapSrc = extract(body, 'function workshopSnapshot(){');
  const restoreSrc = extract(body, 'function workshopRestoreSnapshot(snap){');
  const V = () => new THREE.Vector3(0, 1, 0);
  globalThis.__parts = new Map();
  globalThis.workshopParts = [];
  globalThis.workshopGroups = [];
  globalThis.workshopWires = [];
  workshopBonds = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  globalThis.workshopSymmetryEnabled = true;
  globalThis.workshopSnapIncrement = .25;
  globalThis.workshopNextId = 1; globalThis.workshopNextSymmetryId = 1;
  globalThis.workshopLoading = false;
  globalThis.workshopSelectedId = null; globalThis.workshopSelectedWire = null; globalThis.workshopMultiSelect = new Set();
  globalThis.workshopUndoStack = []; globalThis.workshopRedoStack = [];
  const fake = () => ({ add(){}, remove(){}, clear(){}, children: [] });
  globalThis.workshopBuildRoot = fake(); globalThis.workshopWireRoot = fake(); globalThis.workshopGlueRoot = fake(); globalThis.workshopWaypointRoot = fake();
  globalThis.workshopCreatePart = (type, st) => { const p = { userData: { partId: st.id, type, symmetryPairId: st.symmetryPairId }, position: V() }; globalThis.workshopParts.push(p); globalThis.__parts.set(st.id, p); return p; };
  globalThis.workshopPartState = (p) => ({ id: p.userData.partId, type: p.userData.type, position: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
  globalThis.workshopSelectPart = () => {}; globalThis.workshopUpdateStats = () => {}; globalThis.workshopUpdateEmptyHint = () => {}; globalThis.workshopUpdateHistoryButtons = () => {};
  globalThis.workshopRebuildWires = () => {}; globalThis.workshopRebuildBonds = () => {};
  $('workshopName').value = 'x'; $('workshopSymmetryToggle').textContent = ''; $('workshopSnapSize').value = '.25';

  let snapshot; eval(snapSrc.replace('function workshopSnapshot', 'snapshot = function workshopSnapshot'));
  let restore; eval(restoreSrc.replace('function workshopRestoreSnapshot', 'restore = function workshopRestoreSnapshot'));
  const snap = snapshot();
  assert.deepEqual(snap.bonds, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'snapshot carries bonds');
  workshopBonds = [];
  restore({ ...snap, parts: [
    { id: 'a', type: 'fuselageTube', position: { x: 0, y: 1, z: 0 }, scale: 1 },
    { id: 'b', type: 'cockpitBlock', position: { x: 2, y: 1, z: 0 }, scale: 1 },
    { id: 'c', type: 'fuelTank', position: { x: 4, y: 1, z: 0 }, scale: 1 }
  ] });
  assert.deepEqual(workshopBonds, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'restore rebuilds bonds');
});

/* ---------- EnergyCore: the 8 energy forms + conservation ---------- */

function energyEnv() {
  const m = body.match(/const EnergyCore=\{[\s\S]*?\n\};/)[0];
  globalThis.EnergyCore = eval('(' + m.replace('const EnergyCore=', '').replace(/;\s*$/, '') + ')');
  globalThis.WORKSHOP_WIRE_STIFFNESS = null;
}

test('EnergyCore: kinetic + gravitational — ballistic energy is conserved', () => {
  energyEnv();
  const E = globalThis.EnergyCore;
  let m = 2, y = 100, vy = 0; // 2 kg dropped from 100 m
  const dt = 1 / 360, g = 9.81; // small step: symplectic Euler oscillation ≪ tolerance
  let ePrev = E.gravitational(m, y) + E.kinetic(m, 0);
  for (let i = 0; i < 1800 && y > 0; i++) {
    vy -= g * dt; y += vy * dt;
    const e = E.gravitational(m, Math.max(0, y)) + E.kinetic(m, Math.abs(vy));
    assert.ok(Math.abs(e - ePrev) < 2 * m * g * Math.abs(vy) * dt + .5, `energy drifted: ${e} vs ${ePrev}`); // symplectic oscillation O(g·v·dt)
    ePrev = e;
  }
  assert.ok(Math.abs(ePrev - m * g * 100) < 10, 'total energy should stay ≈ mgh₀'); // within 0.5%
});

test('EnergyCore: elastic spring energy is ½kx² and damped motion converts to heat', () => {
  energyEnv();
  const E = globalThis.EnergyCore;
  assert.ok(Math.abs(E.spring(3000, 0.01) - 0.15) < 1e-9); // ½·3000·0.0001
  // explicit spring–damper oscillator (semi-implicit Euler): mechanical loss == heat gained
  const m = 0.05, k = 2500, c = 2, dt = 1 / 3600; // small step: v changes ~1%/substep
  let x = 0.05, v = 0, heat = 0;
  for (let i = 0; i < 36000; i++) { // 10 s
    const a = (-k * x - c * v) / m;
    v += a * dt; x += v * dt;
    heat += E.damperHeat(c, v, dt);
  }
  const mechLoss = E.spring(k, 0.05) - (E.spring(k, Math.abs(x)) + 0.5 * m * v * v);
  assert.ok(Math.abs(mechLoss - heat) < Math.max(1e-4, heat * 0.02), `mechanical loss ${mechLoss} != heat ${heat}`);
});

test('EnergyCore: thermal step heats toward equilibrium and cools toward ambient', () => {
  energyEnv();
  const E = globalThis.EnergyCore;
  const mcK = 385, hA = 1, Tamb = 20;
  // constant 5 W into the body: equilibrium is 20 + 5/1 = 25 °C
  let T = 20;
  for (let i = 0; i < 120000; i++) T = E.thermalStep(T, 5, mcK, hA, Tamb, 1 / 60); // ~5 time constants
  assert.ok(Math.abs(T - 25) < 0.2, `did not reach equilibrium: ${T}`);
  // cooling with no input returns to ambient, no overshoot
  let T2 = 80;
  let prev = 80;
  for (let i = 0; i < 200000; i++) { T2 = E.thermalStep(T2, 0, mcK, hA, Tamb, 1 / 60); assert.ok(T2 <= prev + 1e-9, 'cooling overshot'); prev = T2; }
  assert.ok(Math.abs(T2 - 20) < 0.2, `did not cool to ambient: ${T2}`);
});

test('EnergyCore: battery floors at zero; fuel energy uses Jet-A density', () => {
  energyEnv();
  const E = globalThis.EnergyCore;
  let e = 100;
  for (let i = 0; i < 20; i++) e = E.batteryStep(e, 10, 1);
  assert.equal(e, 0);
  assert.ok(Math.abs(E.fuelEnergy(100) - 4.302e9) < 1e6); // 100 kg Jet-A ≈ 4.302 GJ
  assert.ok(Math.abs(E.radiantFromDraw(100) - 15) < 1e-9); // 15% radiant
});

test('fwEnergyLedger: computes every form from live state', () => {
  energyEnv();
  const E = globalThis.EnergyCore;
  const ledSrc = extract(body, 'function fwEnergyLedger(){');
  globalThis.FW_LIGHT_TYPES = ['navLight', 'strobeLight', 'beaconLight', 'landingLight'];
  globalThis.FW_ELECTRIC_LOAD = { navLight: 5, landingLight: 45, fuelTank: 0 };
  // stub the live-state dependencies
  globalThis.getActiveAircraft = () => ({ massKg: 900 });
  globalThis.systems = { fuel: 50, fuelCapacity: 100 }; // 50 kg fuel
  globalThis.S = { customAircraft: null };
  globalThis.plane = { position: { y: 1000 } };
  globalThis.physicsVelocity = { length: () => 50 };
  globalThis.Electrics = { active: true, loadW: 240 };
  globalThis.workshopParts = [
    { userData: { type: 'landingLight' } }, { userData: { type: 'navLight' } }, { userData: { type: 'fuelTank' } }
  ];
  let ledger; eval(ledSrc.replace('function fwEnergyLedger', 'ledger = function fwEnergyLedger'));
  const led = ledger();
  assert.ok(Math.abs(led.ke - .5 * 950 * 2500) < 1e-6, 'KE ½mv²');
  assert.ok(Math.abs(led.pe - 950 * 9.81 * 1000) < 1e-6, 'GPE mgh');
  assert.ok(Math.abs(led.chem - 50 * 43.02e6) < 1e3, 'chemical fuel');
  assert.equal(led.elW, 240, 'electrical draw');
  assert.equal(led.lampW, 50, 'lamp draw 45+5');
  assert.equal(led.lightW, E.radiantFromDraw(50), 'light output');
  assert.ok(Math.abs(led.massKg - 950) < 1e-9, 'mass includes fuel');
});
