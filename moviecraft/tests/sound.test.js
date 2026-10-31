import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToFreq, scaleSet, normalizeScore, encodeWav, SCALES, DRUMS, makeTrack, STYLES, applyStyle } from '../soundstudio.js';

test('midiToFreq: A4 = 440, octaves double', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(57) - 220) < 1e-9);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('scaleSet: root membership across every scale', () => {
  for (const name of Object.keys(SCALES)) {
    const set = scaleSet(60, name);
    assert.ok(set.has(60), `${name} contains root`);
    assert.ok(set.has(60 + 12), `${name} contains octave`);
  }
  // natural minor = major shifted: C natural minor has Eb, no E natural
  const cm = scaleSet(60, 'Natural minor');
  assert.ok(cm.has(63) && !cm.has(64));
  assert.equal(DRUMS.length, 12);
  assert.ok(DRUMS.includes('808 kick') && DRUMS.includes('Shaker'));
});

test('normalizeScore: fills defaults, clamps, quantizes', () => {
  const s = normalizeScore({
    name: 'x', bpm: 999, bars: 2.7, root: 200, scale: 'Nope',
    tracks: [
      { kind: 'bogus', notes: [{ t: 1.3, d: 0.4, m: 999, v: 5 }, null, { t: -2, d: 0.1, m: 'NaN' }] },
      'garbage',
    ],
  });
  assert.ok(s && s.id);
  assert.equal(s.bpm, 300);            // clamped to max
  assert.equal(s.bars, 3);             // rounded
  assert.equal(s.root, 120);           // clamped
  assert.equal(s.scale, 'Natural minor'); // unknown scale → default
  assert.equal(s.tracks.length, 1);    // garbage track dropped
  const n = s.tracks[0].notes[0];
  assert.equal(n.t, 1.25);             // quantized to 0.25
  assert.equal(n.d, 0.5);               // min duration 0.25, quantized
  assert.equal(n.m, 120);               // clamped
  assert.equal(n.v, 1);                // clamped
  assert.ok(normalizeScore(null) === null && normalizeScore('x') === null);
});

test('normalizeScore: vocal fields survive, ids stable-ish', () => {
  const s = normalizeScore({ tracks: [{ kind: 'vocal', assetId: 'aud1', startBeats: -4, notes: [] }] });
  const tr = s.tracks[0];
  assert.equal(tr.kind, 'vocal');
  assert.equal(tr.assetId, 'aud1');
  assert.equal(tr.startBeats, 0);
  const s2 = normalizeScore({ id: 'keepme', tracks: [] });
  assert.equal(s2.id, 'keepme');
});

test('makeTrack: every kind returns a full track (startup regression v0.12.1)', () => {
  for (const kind of ['synth', 'bass', 'pad', 'pluck', 'drum', 'vocal']) {
    const t = makeTrack(kind);
    assert.ok(t && typeof t === 'object', `${kind} track exists`);
    assert.equal(t.kind, kind);
    assert.ok(Array.isArray(t.notes), `${kind} has notes array`);
    assert.ok(t.id && t.name);
  }
  const dr = makeTrack('drum');
  assert.ok(dr.notes.length > 0, 'drum track ships with a starter groove');
  assert.equal(dr.notes[0].m, 0, 'first drum note is a kick');
});

test('styles: every template builds a valid, in-range arrangement', () => {
  for (const [name, st] of Object.entries(STYLES)) {
    const score = { id: 'x', name: 't', bpm: 120, bars: 8, root: 60, scale: 'Major', tracks: [] };
    assert.ok(applyStyle(score, name), name + ' applies');
    assert.equal(score.bpm, st.bpm);
    assert.ok(score.tracks.length >= 3, name + ' has several tracks');
    for (const tr of score.tracks) {
      assert.ok(KIND_OK(tr.kind), name + ' track kind valid: ' + tr.kind);
      assert.ok(Array.isArray(tr.notes) && tr.notes.length, name + ' track has notes');
      for (const n of tr.notes) {
        assert.ok(n.t >= 0 && n.d >= 0.25 && n.v > 0, name + ' note sane');
        if (tr.kind !== 'drum') assert.ok(n.m >= 24 && n.m <= 96, name + ' melodic note in roll range: ' + n.m);
        else assert.ok(n.m >= 0 && n.m < DRUMS.length, name + ' drum row valid: ' + n.m);
        assert.ok(n.t <= score.bars * 4 + 0.01, name + ' note inside score length');
      }
    }
  }
  assert.equal(applyStyle({ id: 'x' }, 'Nope'), false);
  assert.equal(applyStyle(null, 'Pop'), false);
});

function KIND_OK(k) {
  return ['synth', 'lead', 'bass', 'bass808', 'pad', 'pluck', 'piano', 'epiano', 'organ', 'guitar',
    'strings', 'brass', 'flute', 'bell', 'marimba', 'drum', 'sfx', 'vocal'].includes(k);
}

test('encodeWav: 44-byte PCM header + interleaved samples', () => {
  const buf = {
    numberOfChannels: 2, length: 3, sampleRate: 48000,
    getChannelData: (c) => c === 0 ? [0.5, -0.5, 0] : [0.25, 0.25, 0.25],
  };
  const blob = encodeWav(buf);
  assert.equal(blob.type, 'audio/wav');
  return blob.arrayBuffer().then(ab => {
    assert.equal(ab.byteLength, 44 + 3 * 2 * 2);
    const v = new DataView(ab);
    assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
    assert.equal(v.getUint32(4, true), ab.byteLength - 8);
    assert.equal(String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11)), 'WAVE');
    assert.equal(String.fromCharCode(v.getUint8(12), v.getUint8(13), v.getUint8(14), v.getUint8(15)), 'fmt ');
    assert.equal(v.getUint16(20, true), 1);        // PCM
    assert.equal(v.getUint16(22, true), 2);        // channels
    assert.equal(v.getUint32(24, true), 48000);     // sample rate
    assert.equal(v.getUint32(28, true), 48000 * 4); // byte rate
    assert.equal(v.getUint32(40, true), 12);        // data bytes
    assert.equal(v.getInt16(44, true), Math.trunc(0.5 * 0x7FFF));
    assert.equal(v.getInt16(46, true), Math.trunc(0.25 * 0x7FFF));
    assert.equal(v.getInt16(48, true), Math.trunc(-0.5 * 0x8000));
  });
});
