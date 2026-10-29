import test from 'node:test';
import assert from 'node:assert/strict';
import { planBlocks, clipSegmentsInBlock, chunkPlan } from '../export-audio.js';

test('planBlocks splits a range into bounded blocks', () => {
  const blocks = planBlocks(75, 30);
  assert.deepEqual(blocks.map(b => b.duration), [30, 30, 15]);
  assert.equal(blocks[1].start, 30);
  assert.equal(blocks[2].start, 60);
});

test('planBlocks handles exact multiples and empty ranges', () => {
  assert.deepEqual(planBlocks(60, 30), [{ start: 0, duration: 30 }, { start: 30, duration: 30 }]);
  assert.deepEqual(planBlocks(0, 30), []);
});

test('clipSegmentsInBlock places a clip fully inside the block', () => {
  const clips = [{ start: 5, duration: 10 }];
  const segs = clipSegmentsInBlock(clips, 0, 30);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].offset, 0);
  assert.equal(segs[0].when, 5);
  assert.equal(segs[0].duration, 10);
});

test('clipSegmentsInBlock slices a clip spanning several blocks', () => {
  const clips = [{ start: 20, duration: 50 }]; // plays 20s → 70s
  const first = clipSegmentsInBlock(clips, 0, 30);
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].offset, first[0].when, first[0].duration], [0, 20, 10]);
  const second = clipSegmentsInBlock(clips, 30, 30);
  assert.deepEqual([second[0].offset, second[0].when, second[0].duration], [10, 0, 30]);
  const last = clipSegmentsInBlock(clips, 60, 30);
  assert.deepEqual([last[0].offset, last[0].when, last[0].duration], [40, 0, 10]);
});

test('clipSegmentsInBlock skips clips that miss the block', () => {
  const clips = [{ start: 0, duration: 5 }, { start: 40, duration: 5 }];
  assert.equal(clipSegmentsInBlock(clips, 10, 10).length, 0);
  // open-ended clip (unknown duration) plays to the end of the movie
  const open = [{ start: 25 }];
  const segs = clipSegmentsInBlock(open, 20, 10);
  assert.deepEqual([segs[0].offset, segs[0].when, segs[0].duration], [0, 5, 5]);
});

test('clipSegmentsInBlock trims a clip starting before the block', () => {
  const clips = [{ start: 0, duration: 100 }];
  const segs = clipSegmentsInBlock(clips, 30, 30);
  assert.deepEqual([segs[0].offset, segs[0].when, segs[0].duration], [30, 0, 30]);
});

test('chunkPlan steps in encoder-sized frames with µs timestamps', () => {
  const plan = chunkPlan(0, 1920, 48000, 960);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map(p => p.frames), [960, 960]);
  assert.equal(plan[0].timestampUs, 0);
  assert.equal(plan[1].timestampUs, 20000);
  assert.equal(plan[1].startSample, 960);
});

test('chunkPlan emits a short final frame instead of padding', () => {
  const plan = chunkPlan(30, 1200, 48000, 960);
  assert.deepEqual(plan.map(p => p.frames), [960, 240]);
  assert.equal(plan[1].timestampUs, Math.round((30 + 960 / 48000) * 1e6));
  assert.equal(plan[1].timestampUs, 30020000); // 30 s + 960 samples (20 ms)
});

test('clipSegmentsInBlock keeps playing a clip that started before the range', () => {
  // clip began 10 s before the export range and lasts 12 s → 2 s remain in range,
  // continuing from source offset 10, not restarting from 0
  const clips = [{ start: -10, duration: 12 }];
  const segs = clipSegmentsInBlock(clips, 0, 16);
  assert.equal(segs.length, 1);
  assert.deepEqual([segs[0].offset, segs[0].when, segs[0].duration], [10, 0, 2]);
  // split across blocks: the tail lands in the next block still offset correctly
  const clips2 = [{ start: -5, duration: 40 }];
  const segs2 = clipSegmentsInBlock(clips2, 30, 30);
  assert.deepEqual([segs2[0].offset, segs2[0].when, segs2[0].duration], [35, 0, 5]);
});
