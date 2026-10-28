import test from 'node:test';
import assert from 'node:assert/strict';
import { easing, sampleKeys, movieIndex, locateTime, renderRange, shotFilm, fadeAmount, parseSRT, movieSRT, inspectGLB } from '../film.js';
import { createSet, SETS } from '../sets.js';
import { validateModel, defaultStudio, normalizeStudio, hasProductionWork } from '../production.js';
import { Muxer, ArrayBufferTarget, StreamTarget } from '../vendor/webm-muxer.mjs';

const shots = [{ id: 'a', duration: 10 }, { id: 'b', duration: 20 }, { id: 'c', duration: 5 }];
test('easing curves clamp endpoints and retain hold behavior', () => {
  for (const name of ['ease', 'linear', 'in', 'out', 'inout', 'step']) {
    assert.equal(easing(-2, name), 0); assert.equal(easing(2, name), 1);
  }
  assert.equal(easing(0.5, 'step'), 0); assert.equal(easing(0.5, 'in'), 0.125);
  assert.equal(easing(0.5, 'out'), 0.875); assert.equal(easing(0.5, 'inout'), 0.5);
});
test('track samples are deterministic forward and backward', () => {
  const keys = [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 10, ease: 'step' }, { t: 2, v: -5 }];
  assert.equal(sampleKeys(keys, 0.5), 5); assert.equal(sampleKeys(keys, 1.5), 10);
  assert.equal(sampleKeys(keys, 2), -5); assert.equal(sampleKeys(keys, -4), 0);
  assert.equal(sampleKeys([], 1), null); assert.equal(sampleKeys(keys, 0.5), 5);
});
test('dense tracks use stable interpolation at exact keys', () => {
  const keys = Array.from({ length: 10000 }, (_, i) => ({ t: i, v: i * 2, ease: 'linear' }));
  assert.equal(sampleKeys(keys, 5000.25), 10000.5);
  assert.equal(sampleKeys(keys, 9999), 19998);
});
test('movie boundaries use the incoming shot, and exact end uses last frame', () => {
  const index = movieIndex(shots);
  assert.equal(locateTime(index, 10).shot.id, 'b'); assert.equal(locateTime(index, 10).local, 0);
  assert.equal(locateTime(index, 35).shot.id, 'c'); assert.equal(locateTime(index, 90).local, 5);
  assert.equal(locateTime(index, -1).local, 0);
});
test('one-hour timeline supports every boundary and reverse seeking', () => {
  const many = Array.from({ length: 240 }, (_, i) => ({ id: 'shot_' + i, duration: 15 }));
  const index = movieIndex(many); assert.equal(index.at(-1).end, 3600);
  for (let i = many.length - 1; i >= 0; i--) {
    assert.equal(locateTime(index, i * 15).shot.id, many[i].id);
    assert.equal(locateTime(index, i * 15 + 14.9).shot.id, many[i].id);
  }
  assert.deepEqual(renderRange(many, 'shot_239', { mode: 'range', start: 3598, end: 3600 }), { start: 3598, end: 3600, duration: 2 });
});
test('render whole, active shot and explicit section', () => {
  assert.deepEqual(renderRange(shots, 'b'), { start: 0, end: 35, duration: 35 });
  assert.deepEqual(renderRange(shots, 'b', { mode: 'shot' }), { start: 10, end: 30, duration: 20 });
  assert.deepEqual(renderRange(shots, 'b', { mode: 'range', start: 9, end: 11 }), { start: 9, end: 11, duration: 2 });
});
test('invalid render ranges fail instead of silently changing the request', () => {
  for (const [start, end] of [[-1, 1], [1, 36], [10, 10], [11, 10]]) assert.throws(() => renderRange(shots, 'a', { mode: 'range', start, end }));
  assert.throws(() => renderRange(shots, 'missing', { mode: 'shot' })); assert.throws(() => locateTime([], 0));
});
test('legacy shots do not get forced exposure or fog overrides', () => {
  const film = shotFilm(); assert.equal(film.exposure, null); assert.equal(film.fog, null);
  assert.equal(fadeAmount(film, 0, 10), 0);
});
test('film values normalize and unsafe caption values are stripped', () => {
  const film = shotFilm({ background: 'javascript:', ground: 'red', fog: 1, exposure: 100, fadeIn: 100,
    captions: [null, { start: 3, end: 2, text: 'Bad' }, { start: 0, end: 2, text: 'Good', size: 99, color: 'bad' }] });
  assert.equal(film.background, ''); assert.equal(film.fog, 0.12); assert.equal(film.exposure, 3);
  assert.equal(film.fadeIn, 10); assert.equal(film.captions.length, 1);
  assert.equal(film.captions[0].size, 10); assert.equal(film.captions[0].color, '#ffffff');
});
test('fade envelopes cap to half the shot and meet at a visible midpoint', () => {
  const film = { fadeIn: 10, fadeOut: 10 };
  assert.equal(fadeAmount(film, 0, 2), 1); assert.equal(fadeAmount(film, 1, 2), 0);
  assert.equal(fadeAmount(film, 0.5, 2), 0.5); assert.equal(fadeAmount(film, 2, 2), 1);
});
test('SRT parser handles BOM, CRLF, formatting and multiline dialogue', () => {
  assert.deepEqual(parseSRT('\uFEFF1\r\n00:00:01,200 --> 00:00:03,000\r\n<b>Hello</b>\r\nworld\r\n'),
    [{ start: 1.2, end: 3, text: 'Hello\nworld' }]);
});
test('SRT parser rejects invalid times and empty text', () => {
  for (const text of ['invalid', '1\n00:70:00,000 --> 00:71:00,000\nNo', '1\n00:00:03,000 --> 00:00:01,000\nNo', '1\n00:00:00,000 --> 00:00:01,000'])
    assert.throws(() => parseSRT(text));
});
test('SRT output uses movie times and excludes centered titles', () => {
  const output = movieSRT([{ duration: 10 }, { duration: 5, film: { captions: [
    { start: 1.2, end: 4, text: 'Go!', position: 'bottom' },
    { start: 0, end: 2, text: 'Title', position: 'center' },
  ] } }]);
  assert.match(output, /00:00:11,200 --> 00:00:14,000/); assert.doesNotMatch(output, /Title/);
  assert.equal(parseSRT(output)[0].start, 11.2);
});
test('sets are independent, editable compound objects within part limits', () => {
  for (const [kind] of SETS) {
    const a = createSet(kind), b = createSet(kind);
    assert.ok(validateModel({ name: a.object.name, parts: a.object.modelParts }).parts.length > 15);
    assert.notEqual(a.object.id, b.object.id); a.object.modelParts[0].color = '#000000';
    assert.notEqual(b.object.modelParts[0].color, '#000000');
    assert.ok(a.camera.pos.length === 3); assert.equal(a.object.locked, true);
  }
});
const glb = json => {
  const bytes = new TextEncoder().encode(JSON.stringify(json)), size = Math.ceil(bytes.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + size), view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, size, 0x4e4f534a].forEach((n, i) => view.setUint32(i * 4, n, true));
  new Uint8Array(buffer, 20).fill(32); new Uint8Array(buffer, 20, bytes.length).set(bytes); return buffer;
};
test('GLB inspection accepts self-contained animated meshes', () => {
  assert.deepEqual(inspectGLB(glb({ meshes: [{}], nodes: [{}], animations: [{ name: 'Run' }, {}] })), { meshes: 1, animations: ['Run', 'Clip 2'] });
});
test('GLB external buffers/textures and unsupported compression are rejected', () => {
  assert.throws(() => inspectGLB(glb({ meshes: [{}], buffers: [{ uri: 'https://example.com/a.bin' }] })), /self-contained/);
  assert.throws(() => inspectGLB(glb({ meshes: [{}], images: [{ uri: '../secret.png' }] })), /self-contained/);
  assert.throws(() => inspectGLB(glb({ meshes: [{}], extensionsRequired: ['KHR_draco_mesh_compression'] })), /Compressed/);
  assert.throws(() => inspectGLB(new ArrayBuffer(20))); assert.throws(() => inspectGLB(glb({})), /meshes/);
});
test('imports and delivery settings survive normalization and protect work', () => {
  const s = defaultStudio(); s.imports.push({ id: 'glb1', name: 'Actor', dataURL: 'data:model/gltf-binary;base64,AAAA', animations: ['Walk'] });
  s.delivery = { mode: 'range', start: 3598, end: 3600, disk: true };
  const restored = normalizeStudio(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.imports, s.imports); assert.deepEqual(restored.delivery, s.delivery);
  assert.ok(hasProductionWork(restored));
});
test('invalid imported asset sources are not retained in project data', () => {
  const s = normalizeStudio({ imports: [{ id: 'x', dataURL: 'https://example.com/model.glb' }, null] });
  assert.equal(s.imports.length, 0);
});
function segmentDuration(bytes) {
  for (let i = 0; i < bytes.length - 10; i++)
    if (bytes[i] === 0x44 && bytes[i+1] === 0x89 && bytes[i+2] === 0x88)
      return new DataView(bytes.buffer, bytes.byteOffset).getFloat64(i + 3, false);
  throw new Error('Segment duration not found');
}
test('muxer duration includes the final display frame in a memory export', () => {
  const target = new ArrayBufferTarget(), muxer = new Muxer({ target, video:{ codec:'V_VP8', width:16, height:16, frameRate:10 } });
  for (let i = 0; i < 10; i++) muxer.addVideoChunkRaw(new Uint8Array([0]), i === 0 ? 'key' : 'delta', i * 100000);
  muxer.finalize(); assert.equal(segmentDuration(new Uint8Array(target.buffer)), 1000);
});
test('seekable streaming output includes a full single-frame duration', () => {
  const chunks = [];
  const target = new StreamTarget({ chunked:true, onData:(data, position) => chunks.push({ data:data.slice(), position }) });
  const muxer = new Muxer({ target, video:{ codec:'V_VP8', width:16, height:16, frameRate:25 } });
  muxer.addVideoChunkRaw(new Uint8Array([0]), 'key', 0); muxer.finalize();
  const bytes = new Uint8Array(Math.max(...chunks.map(c => c.position + c.data.length)));
  chunks.forEach(c => bytes.set(c.data, c.position)); assert.equal(segmentDuration(bytes), 40);
});
