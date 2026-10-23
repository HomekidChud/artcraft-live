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
