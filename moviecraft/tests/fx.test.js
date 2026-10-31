import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_KINDS, FX_PRESETS, defaultFxProps, fxParticleAge, fxAgeFade, fxSeeds } from '../fx-core.js';

test('all FX kinds have complete presets', () => {
  assert.ok(FX_KINDS.length >= 5);
  for (const kind of FX_KINDS) {
    const p = FX_PRESETS[kind];
    assert.ok(p, 'preset missing for ' + kind);
    assert.ok(p.life > 0, kind + ' life');
    assert.ok(p.count >= 20, kind + ' count');
    assert.equal(p.colors.length, 3, kind + ' colour ramp');
    assert.equal(typeof p.additive, 'boolean', kind + ' blending');
    assert.equal(typeof p.oneShot, 'boolean', kind + ' oneShot');
  }
});

test('defaultFxProps falls back to fire for unknown kinds', () => {
  assert.equal(defaultFxProps('nonsense').fxKind, 'fire');
  assert.deepEqual(defaultFxProps('smoke'), { fxKind: 'smoke', intensity: 1, fxSize: 1, fxSpeed: 1, fxStart: 0 });
});

test('looping effects are pure functions of time (scrub-safe, export-safe)', () => {
  for (const kind of ['fire', 'smoke', 'sparks', 'fountain', 'rain', 'snow', 'embers', 'magic', 'dust', 'fireworks', 'portal', 'hearts', 'stars']) {
    for (const seed of [0, 0.25, 0.9]) {
      const a = fxParticleAge(kind, seed, 1.234);
      const b = fxParticleAge(kind, seed, 1.234);
      assert.equal(a, b, kind + ' age must be deterministic');
      assert.ok(a >= 0 && a < 1, kind + ' looping age in [0,1)');
      // evaluating out of order (scrub back) must reproduce the same frame
      fxParticleAge(kind, seed, 9.7);
      assert.equal(fxParticleAge(kind, seed, 1.234), a, kind + ' must not carry simulation state');
    }
  }
});

test('looping effects are hidden before their start time too', () => {
  for (const kind of ['fire', 'smoke', 'sparks', 'fountain', 'rain', 'snow', 'embers', 'magic', 'dust', 'fireworks', 'portal', 'hearts', 'stars']) {
    const age = fxParticleAge(kind, 0.5, 1.0, 2.0);
    assert.equal(age, -1, kind + ' must gate on fxStart');
    assert.equal(fxAgeFade(kind, age), 0, kind + ' invisible before start');
    // and visible after it
    const after = fxParticleAge(kind, 0.5, 2.5, 2.0);
    assert.ok(after >= 0 && after < 1, kind + ' loops after start');
    assert.ok(fxAgeFade(kind, after) > 0, kind + ' visible after start');
  }
});

test('seed buffers are deterministic across rebuilds and unique per object', () => {
  const o = { id: 'obj_abc123' };
  const a = fxSeeds(o, 64);
  const b = fxSeeds({ ...o }, 64); // same id, fresh object (a rebuild)
  assert.deepEqual([...a], [...b], 'rebuild must reproduce the exact particle field');
  const c = fxSeeds({ id: 'obj_other' }, 64);
  assert.notDeepEqual([...a], [...c], 'different effects must not share a field');
  assert.ok(a.every(v => v >= 0 && v < 1), 'seeds in [0,1)');
  assert.ok(new Set(a).size > 40, 'seeds are well distributed'); // 256 samples from a 32-bit hash
});

test('explosion is one-shot and gated on its start time', () => {
  // before the start time the effect is invisible
  assert.equal(fxParticleAge('explosion', 0.5, 1.0, 2.0), -1);
  assert.equal(fxAgeFade('explosion', fxParticleAge('explosion', 0.5, 1.0, 2.0)), 0);
  // at/after the start it burns, then burns out
  const mid = fxParticleAge('explosion', 0.5, 2.5, 2.0);
  assert.ok(mid >= 0 && mid <= 1, 'mid-burst age in [0,1]');
  assert.ok(fxAgeFade('explosion', mid) > 0, 'visible during burst');
  const late = fxParticleAge('explosion', 0.0, 6.0, 2.0);
  assert.ok(late > 1, 'burnt out after its lifetime');
  assert.equal(fxAgeFade('explosion', late), 0, 'invisible after burnout');
});

test('age fades stay within [0,1] across the full life', () => {
  for (const kind of FX_KINDS) {
    for (let a = -0.2; a <= 1.4; a += 0.05) {
      const f = fxAgeFade(kind, a);
      assert.ok(f >= 0 && f <= 1, kind + ' fade out of range at age ' + a);
    }
  }
});
