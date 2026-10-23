import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* End-to-end: client save shape -> POST /api/builds -> GET /api/builds/:id ->
 * the fetched document re-validates through the CLIENT's validateDesign and
 * the routed wires survive the round trip. The server runs in-process on an
 * ephemeral port; the client function is extracted verbatim from index.html. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'airplanecraft', 'index.html'), 'utf8');
const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

function extract(src, header) {
  let i = src.indexOf(header);
  if (i < 0) throw new Error('missing ' + header);
  let j = i;
  while (true) {
    j = src.indexOf('\n', j + 1);
    const line = src.slice(j + 1, src.indexOf('\n', j + 1));
    if (line.startsWith('function ') || line.startsWith('const ')) break;
  }
  const out = src.slice(i, j);
  return out.slice(0, out.lastIndexOf('}') + 1);
}

const validateSrc = extract(body, 'function validateDesign(input, catalog) {');
const catMatch = body.match(/const WORKSHOP_PARTS=\{([\s\S]*?)\n\};/);
fs.writeFileSync('/tmp/fw_catalog2.mjs', 'export const WORKSHOP_PARTS={' + catMatch[1] + '\n};\n');
const { WORKSHOP_PARTS } = await import('file:///tmp/fw_catalog2.mjs');
const vd = (input) => eval('(' + validateSrc + ')')(input, WORKSHOP_PARTS);

test('client save -> server -> reload round-trips a routed preset intact', async (t) => {
  const { createServer, initStore } = await import(path.join(ROOT, 'server', 'index.js'));
  await initStore();
  const srv = createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  t.after(() => new Promise(r => srv.close(r)));

  // pick a routed preset from the pack (one with waypoint wires)
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'airplanecraft', 'presets-fleet.json'), 'utf8'));
  const doc = pack.find(d => d.data.build.wires.some(w => w.waypoints) && d.data.build.wires.some(w => w.kind === 'hydraulic'))
    || pack.find(d => d.data.build.wires.some(w => w.waypoints));
  assert.ok(doc, 'no routed preset in pack');

  // 1. client-side save: validate the build exactly as the workshop does before saving
  const validated = vd(doc.data.build);
  const routedBefore = validated.wires.filter(w => w.waypoints).length;
  assert.ok(routedBefore > 0);

  // 2. save to the server with the client's cloud-panel document shape
  const posted = await fetch(base + '/api/builds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: doc.name, kind: 'preset', data: doc.data })
  });
  const postedBody = await posted.text();
  assert.equal(posted.status, 201, postedBody);
  const saved = JSON.parse(postedBody);

  // 3. reload: GET it back and re-validate through the client path
  const got = await fetch(base + '/api/builds/' + saved.id);
  assert.equal(got.status, 200);
  const fetched = await got.json();
  assert.equal(fetched.data.schema, 'flightworld-build');
  const revalidated = vd(fetched.data.build);
  assert.equal(revalidated.name, doc.name);
  assert.deepEqual(
    revalidated.wires.filter(w => w.waypoints).map(w => w.waypoints).sort(),
    validated.wires.filter(w => w.waypoints).map(w => w.waypoints).sort(),
    'waypoints lost or altered across the save/reload round trip'
  );
  assert.equal(revalidated.wires.filter(w => w.waypoints).length, routedBefore);

  // 4. health endpoint reports the document
  const health = await (await fetch(base + '/api/health')).json();
  assert.ok(health.ok !== undefined);

  // 5. list shows it
  const list = await (await fetch(base + '/api/builds')).json();
  assert.ok(list.some(b => b.id === saved.id));
});
