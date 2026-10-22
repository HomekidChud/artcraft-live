'use strict';
/* Flight World build-sync server tests: validation, CRUD, CORS, rate limit.
 * Storage is isolated: DATA_DIR must point at a temp dir BEFORE index.js is
 * loaded (the server captures it at module init). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));

const { createServer, initStore, validateBuildData } = require('../index.js');

const PORT = 0; // random port
let server, baseUrl;

test.before(async () => {
  process.env.RATE_LIMIT = '1000'; // don't fight the limiter in CRUD tests
  await initStore();
  server = createServer();
  await new Promise(r => server.listen(PORT, r));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server && server.close());

async function api(method, p, body, headers = {}) {
  const res = await fetch(baseUrl + p, {
    method,
    headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers),
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json, headers: res.headers };
}

const snapshot = (over = {}) => Object.assign({
  name: 'Test build', symmetryEnabled: true, snapIncrement: .25,
  parts: [
    { id: 'part-1', type: 'fuelTank', name: 'Tank', position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    { id: 'part-2', type: 'jetEngine', name: 'Engine', position: { x: 0, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
  ],
  wires: [{ from: 'part-1', to: 'part-2', kind: 'fuel' }],
  groups: [{ id: 'grp-1', name: 'Fuel system', parts: ['part-1', 'part-2'] }]
}, over);

test('health endpoint reports storage and version', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.storage);
  assert.ok(r.json.version >= '1.2.0');
});

test('POST saves a build and GET list shows it', async () => {
  const r = await api('POST', '/api/builds', { name: 'My Cessna', kind: 'build', data: snapshot() });
  assert.equal(r.status, 201);
  assert.ok(r.json.id);
  const list = await api('GET', '/api/builds');
  assert.ok(list.json.some(b => b.id === r.json.id && b.kind === 'build'));
  const doc = await api('GET', '/api/builds/' + r.json.id);
  assert.equal(doc.status, 200);
  assert.deepEqual(doc.json.data.wires, snapshot().wires);
  assert.equal(doc.json.data.parts.length, 2);
});

test('end-to-end: save → server → reload returns identical snapshot', async () => {
  const snap = snapshot({ name: 'Roundtrip', snapIncrement: 1, symmetryEnabled: false });
  const save = await api('POST', '/api/builds', { name: 'Roundtrip', kind: 'build', data: snap });
  assert.equal(save.status, 201);
  const reload = await api('GET', '/api/builds/' + save.json.id);
  assert.deepEqual(reload.json.data, snap, 'reloaded snapshot must equal saved snapshot byte-for-byte');
  const del = await api('DELETE', '/api/builds/' + save.json.id);
  assert.equal(del.status, 200);
  const gone = await api('GET', '/api/builds/' + save.json.id);
  assert.equal(gone.status, 404);
});

test('nested groups: a group may contain parts and other groups', async () => {
  // the workshop Explorer allows Ctrl+G groups inside groups — the server must accept them
  const nested = snapshot({
    parts: [
      { id: 'part-1', type: 'cockpitSeat', name: 'Seat', position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { id: 'part-2', type: 'instrumentPanel', name: 'Panel', position: { x: 0, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    ],
    groups: [
      { id: 'grp-cockpit', name: 'Cockpit', parts: ['part-1', 'part-2', 'grp-seats'] },
      { id: 'grp-seats', name: 'Seats', parts: ['part-1'] }
    ]
  });
  const r = await api('POST', '/api/builds', { name: 'Nested', kind: 'build', data: nested });
  assert.equal(r.status, 201);
  const back = await api('GET', '/api/builds/' + r.json.id);
  assert.deepEqual(back.json.data.groups, nested.groups);
  // but a group referencing a totally unknown id is still rejected
  const bad = snapshot({ groups: [{ id: 'g', name: 'G', parts: ['part-1', 'ghost'] }] });
  const r2 = await api('POST', '/api/builds', { name: 'BadNested', kind: 'build', data: bad });
  assert.equal(r2.status, 400);
});

test('validation rejects malformed builds the same way the client does', async () => {
  // unknown component type
  assert.throws(() => validateBuildData(snapshot({ parts: [{ id: 'part-1', type: 'Not A Type!' }] })), /component at 1/);
  // duplicate ids
  assert.throws(() => validateBuildData({ parts: [
    { id: 'part-1', type: 'a' }, { id: 'part-1', type: 'a' }
  ] }), /duplicate component ID/);
  // out-of-range position
  assert.throws(() => validateBuildData({ parts: [{ id: 'part-1', type: 'a', position: { x: 9999, y: 0, z: 0 } }] }), /position/);
  // wire to unknown part
  assert.throws(() => validateBuildData(snapshot({ wires: [{ from: 'part-1', to: 'part-99', kind: 'fuel' }] })), /wiring/);
  // bad wire kind
  assert.throws(() => validateBuildData(snapshot({ wires: [{ from: 'part-1', to: 'part-2', kind: 'coffee' }] })), /wiring/);
  // duplicate wire
  assert.throws(() => validateBuildData({ parts: [{ id: 'part-1', type: 'a' }, { id: 'part-2', type: 'a' }], wires: [
    { from: 'part-1', to: 'part-2', kind: 'fuel' }, { from: 'part-2', to: 'part-1', kind: 'fuel' }
  ] }), /Duplicate wiring/);
  // group referencing unknown part
  assert.throws(() => validateBuildData(snapshot({ groups: [{ id: 'g', name: 'G', parts: ['part-77'] }] })), /Group references unknown/);
  // server round-trip: POST rejects invalid build
  const r = await api('POST', '/api/builds', { name: 'Bad', kind: 'build', data: { parts: 'nope' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Rejected build/);
  // preset envelope validated too
  const env = await api('POST', '/api/builds', { name: 'Env', kind: 'preset', data: { schema: 'flightworld-build', build: snapshot() } });
  assert.equal(env.status, 201);
  const badEnv = await api('POST', '/api/builds', { name: 'BadEnv', kind: 'preset', data: { schema: 'flightworld-build', build: { parts: 'x' } } });
  assert.equal(badEnv.status, 400);
});

test('CORS reflects only allowed origins', async () => {
  const good = await fetch(baseUrl + '/api/health', { headers: { Origin: 'https://homekidchud.github.io' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://homekidchud.github.io');
  const bad = await fetch(baseUrl + '/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('rate limiting kicks in on repeated writes', async () => {
  process.env.RATE_LIMIT = '3';
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    // distinct forwarded IP so this test gets its own fresh bucket
    const r = await api('POST', '/api/builds', { name: 'RL', kind: 'build', data: snapshot() }, { 'x-forwarded-for': '10.9.9.9' });
    statuses.push(r.status);
  }
  process.env.RATE_LIMIT = '1000';
  assert.ok(statuses.includes(429), 'expected at least one 429, got ' + statuses.join(','));
  assert.ok(statuses.slice(0, 3).every(s => s === 201));
});

test('seed presets load when the store starts empty', async () => {
  const list = await api('GET', '/api/builds');
  const presets = list.json.filter(b => b.kind === 'preset');
  assert.ok(presets.length >= 4, 'expected seeded presets, got ' + presets.length);
});
