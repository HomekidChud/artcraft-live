import test from 'node:test';
import assert from 'node:assert/strict';
import { newEvent, normalizeEvent, shotEvents, evalShotOverlay, shakeOffset, EVENT_TYPES, TRANSITIONS } from '../cutscene.js';

const shot = events => ({ id: 's1', duration: 5, events, transition: 'cut', transitionDur: 0.5 });

test('newEvent defaults are sane and normalize repairs bad JSON', () => {
  const e = newEvent('title', 1, 2);
  assert.equal(e.type, 'title');
  assert.ok(EVENT_TYPES.includes(e.type));
  const bad = normalizeEvent({ type: 'explosion', start: -5, duration: 0 });
  assert.equal(bad, null);
  const fixed = normalizeEvent({ type: 'shake', start: '1.5', duration: 'x', strength: 9 });
  assert.equal(fixed.type, 'shake');
  assert.equal(fixed.start, 1.5);
  assert.equal(fixed.duration, 2); // fallback
  assert.equal(fixed.strength, 1); // clamped
});

test('shotEvents filters out invalid entries', () => {
  const s = shot([{ type: 'title', start: 0, duration: 2, text: 'Hi' }, { type: 'nope' }, null]);
  assert.equal(shotEvents(s).length, 1);
});

test('fade in: fully black at start, clear at end', () => {
  const s = shot([newEvent('fadein', 0, 1)]);
  assert.equal(evalShotOverlay(s, 0).fade, 1);
  assert.ok(evalShotOverlay(s, 0.5).fade > 0.4 && evalShotOverlay(s, 0.5).fade < 0.6);
  assert.equal(evalShotOverlay(s, 1).fade, 0);
  assert.equal(evalShotOverlay(s, 2).fade, 0); // after the event
});

test('fade out: clear at start, black at end', () => {
  const s = shot([newEvent('fadeout', 3, 2)]);
  assert.equal(evalShotOverlay(s, 3).fade, 0);
  assert.ok(evalShotOverlay(s, 4).fade > 0.4);
  assert.equal(evalShotOverlay(s, 5).fade, 1);
});

test('title ramps in and out, hidden outside its window', () => {
  const s = shot([newEvent('title', 1, 3)]);
  assert.equal(evalShotOverlay(s, 0.5).title, null);
  const early = evalShotOverlay(s, 1.1).title;
  assert.ok(early && early.alpha < 1);
  const mid = evalShotOverlay(s, 2.5).title;
  assert.equal(mid.alpha, 1);
  const late = evalShotOverlay(s, 3.9).title;
  assert.ok(late && late.alpha < 1);
  assert.equal(evalShotOverlay(s, 4.5).title, null);
});

test('letterbox is on for the whole event window', () => {
  const s = shot([newEvent('letterbox', 0, 5)]);
  assert.equal(evalShotOverlay(s, 0).letterbox, true);
  assert.equal(evalShotOverlay(s, 4.9).letterbox, true);
  const off = shot([newEvent('letterbox', 0, 1)]);
  assert.equal(evalShotOverlay(off, 2).letterbox, false);
});

test('shake uses a smooth envelope: zero at the ends, peak in the middle', () => {
  const s = shot([newEvent('shake', 1, 2)]);
  assert.equal(evalShotOverlay(s, 1).shake, 0);
  assert.ok(evalShotOverlay(s, 2).shake > 0.45);
  assert.ok(Math.abs(evalShotOverlay(s, 3).shake) < 1e-6);
});

test('shot transition fade is black at t=0 and clear after the duration', () => {
  const s = shot([]);
  s.transition = 'fade'; s.transitionDur = 1;
  assert.equal(evalShotOverlay(s, 0).fade, 1);
  assert.ok(evalShotOverlay(s, 0.5).fade > 0.45);
  assert.equal(evalShotOverlay(s, 1).fade, 0);
  assert.equal(evalShotOverlay(s, 3).fade, 0);
  const cut = shot([]); cut.transition = 'cut';
  assert.equal(evalShotOverlay(cut, 0).fade, 0);
});

test('shakeOffset is deterministic and bounded', () => {
  const a = shakeOffset(0.5, 2.31);
  const b = shakeOffset(0.5, 2.31);
  assert.deepEqual(a, b);
  const z = shakeOffset(0, 2.31);
  assert.deepEqual(z, [0, 0, 0]);
  for (const v of a) assert.ok(Math.abs(v) <= 0.14 * 1.6 + 1e-9);
  assert.ok(TRANSITIONS.length >= 2);
});
