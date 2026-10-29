// VideoCraft export-audio — pure planning helpers for the frame-accurate
// export's audio mix. No Web APIs here so `node --test` can cover the math.
// The browser glue (decode → OfflineAudioContext mix → AudioEncoder) lives in
// app.js; these functions decide what plays where so preview and export agree.

// Split an export range into render blocks of at most `blockDur` seconds.
// Rendering long movies one block at a time keeps the mix buffer bounded
// (a 2-hour stereo 48 kHz f32 mix would otherwise need ~2.8 GB of RAM).
export function planBlocks(rangeDur, blockDur) {
  const blocks = [];
  let t = 0;
  while (t < rangeDur - 1e-9) {
    const end = Math.min(t + blockDur, rangeDur);
    blocks.push({ start: t, duration: end - t });
    t = end;
  }
  return blocks;
}

// Which clips overlap the block [blockStart, blockStart + blockDur), and how
// each one is placed inside it. `clips` carry mix-time starts (mix time =
// movie time − export range start, so a clip that began before the range has a
// NEGATIVE start and must keep playing from the right source offset) and a
// known `duration`.
export function clipSegmentsInBlock(clips, blockStart, blockDur) {
  const blockEnd = blockStart + blockDur;
  const out = [];
  for (const clip of clips) {
    const start = clip.start ?? 0; // may be negative — do not clamp
    const dur = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : Infinity;
    const clipEnd = start + dur;
    const s = Math.max(start, blockStart);
    const e = Math.min(clipEnd, blockEnd);
    if (e <= s + 1e-9) continue; // no overlap with this block
    out.push({
      clip,
      offset: s - start,   // where to start reading inside the source
      when: s - blockStart, // where it plays inside the block
      duration: e - s,      // how long it plays in this block
    });
  }
  return out;
}

// Chunk a rendered block of `samples` frames into encoder-sized AudioData
// frames (Opus likes 960-sample / 20 ms steps at 48 kHz). Timestamps are
// microseconds in mix time — the muxed file's timeline, where 0 = range start.
export function chunkPlan(blockStart, samples, sampleRate, chunkSamples) {
  const out = [];
  for (let i = 0; i < samples; i += chunkSamples) {
    const frames = Math.min(chunkSamples, samples - i);
    out.push({
      startSample: i,
      frames,
      timestampUs: Math.round((blockStart + i / sampleRate) * 1e6),
    });
  }
  return out;
}
