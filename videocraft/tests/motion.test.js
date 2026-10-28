import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINTS, MOTIONS, motionPose, cameraTracks, exportSize } from '../motion.js';

test('19 unique named joints with symmetric limbs', () => {
  assert.equal(JOINTS.length, 19);
  assert.equal(new Set(JOINTS).size, JOINTS.length);
  JOINTS.filter(j => j.startsWith('left')).forEach(j => assert.ok(JOINTS.includes(j.replace('left', 'right'))));
});
test('all motion presets have finite rotations and root lift', () => {
  for (const clip of MOTIONS) for (const time of [0, 0.1, 1, 3, 600]) {
    const { pose, lift } = motionPose({ clip, speed: 2.3 }, time);
    assert.ok(Number.isFinite(lift));
    assert.equal(Object.keys(pose).length, JOINTS.length);
    Object.values(pose).flat().forEach(v => assert.ok(Number.isFinite(v)));
  }
});
test('backwards scrubbing reproduces exactly the same frame', () => {
  const motion = { clip: 'run', phase: 0.3, speed: 2.3 };
  const first = motionPose(motion, 1.25);
  motionPose(motion, 9); motionPose(motion, 0);
  assert.deepEqual(motionPose(motion, 1.25), first);
});
test('two actors never share pose objects', () => {
  const a = motionPose({ clip: 'walk' }, 0.2), b = motionPose({ clip: 'run' }, 0.2);
  a.pose.head[0] = 900;
  assert.equal(b.pose.head[0], 0);
});
test('clip boundaries and neutral fallback', () => {
  for (const time of [0, 5]) {
    const frame = motionPose({ clip: 'run', start: 1, end: 4 }, time);
    assert.ok(Object.values(frame.pose).flat().every(v => v === 0));
    assert.equal(frame.lift, 0);
  }
});
test('zero strength returns neutral rotations', () => {
  const { pose, lift } = motionPose({ clip: 'celebrate', strength: 0 }, 0.25);
  assert.ok(Object.values(pose).flat().every(v => v === 0)); assert.equal(lift, 0);
});
test('speed, phase and nonfinite inputs handled', () => {
  assert.deepEqual(motionPose({ clip: 'run', speed: 2 }, 0.125), motionPose({ clip: 'run', phase: 0.25 }, 0));
  assert.ok(Number.isFinite(motionPose({ clip: 'run', speed: NaN }, 0.1).lift));
});
test('camera moves author seven editable tracks', () => {
  const a = [1, 2, 3, 4, 5, 6, 46], b = [7, 8, 9, 10, 11, 12, 35];
  const tracks = cameraTracks(a, b, 60, 'linear');
  assert.equal(Object.keys(tracks).length, 7);
  assert.deepEqual(tracks['cam.fov'], [{ t: 0, v: 46, ease: 'linear' }, { t: 60, v: 35, ease: 'linear' }]);
  assert.deepEqual(a, [1, 2, 3, 4, 5, 6, 46]);
});
test('export resolutions have even frame dimensions', () => {
  assert.deepEqual(exportSize(1920, '16:9'), [1920, 1080]);
  assert.deepEqual(exportSize(1080, '9:16'), [1080, 1920]);
  assert.deepEqual(exportSize(1920, '2.39:1'), [1920, 804]);
  assert.deepEqual(exportSize(1280, '1:1'), [1280, 1280]);
});
