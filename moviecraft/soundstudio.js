// soundstudio.js — SoundStudio: full in-browser music & sound creator.
// No samples, no network: every instrument is synthesized with WebAudio.
// Scores live in project.scores and save with the movie. Export renders
// offline to WAV and can be placed on the movie timeline in one click.
//
// score  = { id, name, bpm, bars, root (midi), scale, tracks: [] }
// track  = { id, name, kind: 'synth'|'bass'|'pad'|'pluck'|'drum'|'vocal',
//            osc, cutoff, attack, release, volume, pan, mute, solo,
//            reverb, delay, delayBeats, drive,
//            notes: [{ t, d, m, v }]  (t/d in beats, 0.25-quantized),
//            assetId, startBeats }     (vocal tracks)
// drum m: 0 kick, 1 snare, 2 hat closed, 3 hat open, 4 clap, 5 tom, 6 crash, 7 ride,
//          8 808 kick, 9 rimshot, 10 cowbell, 11 shaker
// sfx tracks: tr.preset picks from SFX_PRESETS; note pitch tunes the effect

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const DRUMS = ['Kick', 'Snare', 'Hat closed', 'Hat open', 'Clap', 'Tom', 'Crash', 'Ride', '808 kick', 'Rimshot', 'Cowbell', 'Shaker'];
export const SFX_PRESETS = ['Riser', 'Impact', 'Whoosh', 'Sub drop', 'Tape stop', 'Vinyl crackle', 'Zap'];
export const INSTRUMENT_KINDS = [
  ['synth', 'Lead synth'], ['lead', 'Square lead'], ['bass', 'Bass synth'], ['bass808', '808 bass'], ['pad', 'Pad'],
  ['pluck', 'Pluck'], ['piano', 'Piano'], ['epiano', 'Electric piano'], ['organ', 'Organ'],
  ['guitar', 'Guitar'], ['strings', 'Strings'], ['brass', 'Brass'], ['flute', 'Flute'],
  ['bell', 'Bell'], ['marimba', 'Marimba'], ['drum', 'Drum kit'], ['sfx', 'Sound FX'], ['vocal', 'Vocals'],
];
const KINDS = INSTRUMENT_KINDS.map(k => k[0]);
export const SCALES = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Natural minor': [0, 2, 3, 5, 7, 8, 10],
  'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Pentatonic major': [0, 2, 4, 7, 9],
  'Pentatonic minor': [0, 3, 5, 7, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const KIND_COLORS = {
  synth: '#4fb3a4', bass: '#e05d5d', bass808: '#b04848', pad: '#c77b9e', pluck: '#f2b25c',
  piano: '#d9c06a', epiano: '#c9a0dc', organ: '#9c8ec4', guitar: '#c98f5e', strings: '#7ea6d9',
  brass: '#d9a05e', flute: '#8ed9c0', bell: '#e0d060', marimba: '#d98f8f', drum: '#7f8fb0',
  sfx: '#d96f9e', vocal: '#8fd18f',
};

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function scaleSet(root, scale) {
  const set = new Set();
  const steps = SCALES[scale] || SCALES['Chromatic'];
  for (let oct = -1; oct <= 8; oct++) for (const s of steps) set.add(root + oct * 12 + s);
  return set;
}
const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);

export function normalizeScore(input) {
  if (!input || typeof input !== 'object') return null;
  const tracks = (Array.isArray(input.tracks) ? input.tracks : [])
    .map(t => t && typeof t === 'object' ? {
      id: String(t.id || 'trk' + Math.random().toString(36).slice(2, 8)),
      name: String(t.name || 'Track').slice(0, 60),
      kind: KINDS.includes(t.kind) ? t.kind : 'synth',
      preset: t.preset && SFX_PRESETS.includes(t.preset) ? t.preset : undefined,
      osc: ['saw', 'square', 'sine', 'triangle'].includes(t.osc) ? t.osc : 'saw',
      cutoff: Math.min(9000, Math.max(100, num(t.cutoff, 2200))),
      attack: Math.min(2, Math.max(0.005, num(t.attack, 0.01))),
      release: Math.min(4, Math.max(0.03, num(t.release, 0.25))),
      volume: Math.min(1.5, Math.max(0, num(t.volume, 0.8))),
      pan: Math.min(1, Math.max(-1, num(t.pan, 0))),
      mute: !!t.mute, solo: !!t.solo,
      reverb: Math.min(1, Math.max(0, num(t.reverb, 0.15))),
      delay: Math.min(1, Math.max(0, num(t.delay, 0))),
      delayBeats: Math.min(4, Math.max(0.1, num(t.delayBeats, 0.75))),
      drive: Math.min(1, Math.max(0, num(t.drive, 0))),
      notes: (Array.isArray(t.notes) ? t.notes : [])
        .map(n => n && typeof n === 'object' ? {
          t: Math.max(0, Math.round(num(n.t, 0) * 4) / 4),
          d: Math.min(16, Math.max(0.25, Math.round(num(n.d, 1) * 4) / 4)),
          m: Math.min(120, Math.max(0, Math.round(num(n.m, 60)))),
          v: Math.min(1, Math.max(0.05, num(n.v, 0.8))),
        } : null).filter(Boolean),
      assetId: t.assetId ? String(t.assetId) : undefined,
      startBeats: Math.max(0, num(t.startBeats, 0)),
    } : null).filter(Boolean);
  const s = {
    id: String(input.id || 'sc' + Math.random().toString(36).slice(2, 8)),
    name: String(input.name || 'Score').slice(0, 60),
    bpm: Math.min(300, Math.max(20, num(input.bpm, 120))),
    bars: Math.min(128, Math.max(1, Math.round(num(input.bars, 16)))),
    root: Math.min(120, Math.max(0, Math.round(num(input.root, 60)))),
    scale: SCALES[input.scale] ? input.scale : 'Natural minor',
    tracks,
  };
  return s;
}

// ---------------------------------------------------------------- WAV encode
export function encodeWav(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels), len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ---------------------------------------------------------------- audio engine
let ctx = null;
function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
const vocalBuffers = new Map(); // assetId -> AudioBuffer
export async function decodeVocal(dataURL) {
  const res = await fetch(dataURL); const arr = await res.arrayBuffer();
  return ensureCtx().decodeAudioData(arr);
}
async function ensureVocalBuffers(hooks, score) {
  for (const tr of score.tracks) {
    if (tr.kind === 'vocal' && tr.assetId && !vocalBuffers.has(tr.assetId)) {
      const asset = hooks.getAudioAsset(tr.assetId);
      if (asset?.dataURL) {
        try { vocalBuffers.set(tr.assetId, await decodeVocal(asset.dataURL)); } catch { /* ignore */ }
      }
    }
  }
}

function impulseResponse(c, seconds = 2.4, decay = 2.6) {
  const sr = c.sampleRate, len = Math.floor(sr * seconds);
  const buf = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function drumHit(c, dest, idx, t, vel, session) {
  const g = c.createGain(); g.connect(dest);
  const noise = (dur, filterType, freq, gain) => {
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = b;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    const ng = c.createGain(); ng.gain.setValueAtTime(gain * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(ng); ng.connect(g);
    src.start(t); src.stop(t + dur + 0.02);
    session.sources.push(src);
  };
  const tone = (f0, f1, dur, gain, type = 'sine') => {
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
    const og = c.createGain(); og.gain.setValueAtTime(gain * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.02);
    session.sources.push(o);
  };
  switch (idx) {
    case 0: tone(150, 42, 0.28, 1.0); break;                       // kick
    case 1: tone(190, 120, 0.12, 0.5, 'triangle'); noise(0.18, 'highpass', 1400, 0.7); break; // snare
    case 2: noise(0.05, 'highpass', 8200, 0.45); break;             // hat closed
    case 3: noise(0.3, 'highpass', 7800, 0.4); break;               // hat open
    case 4: for (let i = 0; i < 3; i++) { const b = c.createBuffer(1, Math.ceil(c.sampleRate * 0.09), c.sampleRate); const d = b.getChannelData(0); for (let j = 0; j < d.length; j++) d[j] = Math.random() * 2 - 1; const src = c.createBufferSource(); src.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * vel, t + i * 0.012); ng.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.012 + 0.08); src.connect(f); f.connect(ng); ng.connect(g); src.start(t + i * 0.012); session.sources.push(src); } break; // clap
    case 5: tone(220, 90, 0.22, 0.8); break;                        // tom
    case 6: noise(1.4, 'highpass', 5200, 0.35); break;              // crash
    case 7: noise(0.6, 'highpass', 6400, 0.28); break;             // ride
    case 8: { // 808 kick — long sub boom with pitch glide
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.09);
      const og = c.createGain(); og.gain.setValueAtTime(1.05 * vel, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.8); session.sources.push(o);
      break;
    }
    case 9: { // rimshot — short bandpass tick
      const b = c.createBuffer(1, Math.ceil(c.sampleRate * 0.03), c.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 2;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.6 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(f); f.connect(ng); ng.connect(g); src.start(t); session.sources.push(src);
      break;
    }
    case 10: { // cowbell — two square oscillators, classic 800/540 Hz
      [800, 540].forEach(f0 => {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f0;
        const og = c.createGain(); og.gain.setValueAtTime(0.25 * vel, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.32); session.sources.push(o);
      });
      break;
    }
    case 11: noise(0.12, 'highpass', 9500, 0.35); break;           // shaker
  }
}

// ---------------------------------------------------------------- instrument voices
// DAW-style synthesized instruments — every kind gets its own recipe.
function noiseBuffer(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.ceil(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function playNoise(c, t, dur, filterType, f0, f1, gain, dest, session) {
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter(); f.type = filterType; f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.02); session.sources.push(src);
}
function mkOsc(c, t, freq, type, dest, session, detune = 0) {
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
  o.connect(dest); o.start(t); session.sources.push(o); return o;
}
function vibLFO(c, t, cents, rate, targets, session) {
  const lfo = c.createOscillator(); lfo.frequency.value = rate;
  const amt = c.createGain(); amt.gain.value = cents;
  lfo.connect(amt); targets.forEach(tg => amt.connect(tg));
  lfo.start(t); session.sources.push(lfo);
}

const VOICES = {
  // Acoustic-ish piano: layered partials, velocity brightness, pitch-based decay
  piano(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = Math.min(9000, freq * (5 + n.v * 5));
    const g = c.createGain(); f.connect(g); g.connect(dest);
    const peak = n.v * 0.6;
    const decay = Math.max(0.35, 2.2 - freq / 500); // low notes ring longer
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(peak * 0.28, t + decay * 0.4);
    g.gain.setTargetAtTime(0.0001, t + dur, Math.max(0.06, tr.release ?? 0.5) / 3);
    const o1 = mkOsc(c, t, freq, 'triangle', f, session);
    const o2 = mkOsc(c, t, freq * 2.001, 'sine', f, session);
    const g2 = c.createGain(); g2.gain.value = 0.35; o2.disconnect(); o2.connect(g2); g2.connect(f);
    const stopAt = t + dur + decay + 0.3;
    o1.stop(stopAt); o2.stop(stopAt);
  },
  // FM electric piano — tine character from a decaying 2x modulator
  epiano(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const carrier = c.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = freq;
    const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * 2;
    const modGain = c.createGain();
    modGain.gain.setValueAtTime(freq * 2.5 * (0.5 + n.v * 0.5), t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.5);
    mod.connect(modGain); modGain.connect(carrier.frequency);
    const g = c.createGain(); carrier.connect(g); g.connect(dest);
    const peak = n.v * 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(peak * 0.45, t + 1.6);
    g.gain.setTargetAtTime(0.0001, t + dur, Math.max(0.08, tr.release ?? 1.2) / 3);
    const stopAt = t + dur + 2.2;
    carrier.start(t); mod.start(t); carrier.stop(stopAt); mod.stop(stopAt);
    session.sources.push(carrier, mod);
  },
  // Drawbar organ — additive sines, full sustain, quick release
  organ(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const g = c.createGain(); g.connect(dest);
    const atk = Math.max(0.008, tr.attack ?? 0.02), rel = Math.max(0.04, tr.release ?? 0.1);
    const peak = n.v * 0.32;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dur + rel);
    const partials = [[1, 1], [2, 0.5], [3, 0.35], [4, 0.2]];
    const stopAt = t + atk + dur + rel + 0.1;
    partials.forEach(([mult, amt]) => {
      const og = c.createGain(); og.gain.value = amt; og.connect(g);
      const o = mkOsc(c, t, freq * mult, 'sine', og, session, mult === 1 ? 0 : 3);
      o.stop(stopAt);
    });
  },
  // Plucked guitar — saw through a closing lowpass with resonant body
  guitar(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(Math.min(9000, freq * 9), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 2.2), t + 0.5);
    const g = c.createGain(); f.connect(g); g.connect(dest);
    const peak = n.v * 0.55;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(peak * 0.25, t + 0.6);
    g.gain.setTargetAtTime(0.0001, t + dur, Math.max(0.05, tr.release ?? 0.5) / 3);
    const o = mkOsc(c, t, freq, 'sawtooth', f, session);
    o.stop(t + dur + 1.2);
  },
  // Ensemble strings — 3 detuned saws, slow swell, vibrato
  strings(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = Math.min(9000, Math.max(300, (tr.cutoff ?? 3800) * (0.5 + n.v * 0.5)));
    const g = c.createGain(); f.connect(g); g.connect(dest);
    const atk = Math.max(0.05, tr.attack ?? 0.35), rel = Math.max(0.1, tr.release ?? 1.0);
    const peak = n.v * 0.26;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + dur);
    g.gain.setTargetAtTime(0.0001, t + atk + dur, rel / 3);
    const detunes = [-9, 0, 9];
    const stopAt = t + atk + dur + rel + 0.5;
    detunes.forEach(d => { const o = mkOsc(c, t, freq, 'sawtooth', f, session, d); o.stop(stopAt); });
    vibLFO(c, t, 6, 5.2, session.sources.slice(-3).map(o => o.detune), session);
  },
  // Brass — saw with a filter swell, punches in
  brass(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(Math.max(120, freq * 1.5), t);
    f.frequency.exponentialRampToValueAtTime(Math.min(9000, freq * 5.5), t + Math.max(0.03, tr.attack ?? 0.06));
    const g = c.createGain(); f.connect(g); g.connect(dest);
    const atk = Math.max(0.02, tr.attack ?? 0.06), rel = Math.max(0.05, tr.release ?? 0.35);
    const peak = n.v * 0.42;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + dur);
    g.gain.setTargetAtTime(0.0001, t + atk + dur, rel / 3);
    const o = mkOsc(c, t, freq, 'sawtooth', f, session);
    o.stop(t + atk + dur + rel + 0.4);
  },
  // Flute — breathy sine plus filtered noise, gentle vibrato
  flute(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const g = c.createGain(); g.connect(dest);
    const atk = Math.max(0.03, tr.attack ?? 0.09), rel = Math.max(0.08, tr.release ?? 0.4);
    const peak = n.v * 0.45;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + dur);
    g.gain.setTargetAtTime(0.0001, t + atk + dur, rel / 3);
    const o = mkOsc(c, t, freq, 'sine', g, session);
    o.stop(t + atk + dur + rel + 0.3);
    vibLFO(c, t, 5, 5, [o.detune], session);
    const breath = c.createGain(); breath.gain.value = 0.08 * n.v; breath.connect(g);
    playNoise(c, t, atk + dur + rel, 'bandpass', freq * 2, freq * 2, 0.5, breath, session);
  },
  // FM bell — inharmonic 3.5x modulator, long shimmering decay
  bell(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m);
    const carrier = c.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = freq;
    const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * 3.5;
    const modGain = c.createGain();
    modGain.gain.setValueAtTime(freq * 2 * n.v, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + 1.2);
    mod.connect(modGain); modGain.connect(carrier.frequency);
    const g = c.createGain(); carrier.connect(g); g.connect(dest);
    const peak = n.v * 0.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    carrier.start(t); mod.start(t); carrier.stop(t + 3.1); mod.stop(t + 3.1);
    session.sources.push(carrier, mod);
  },
  // Marimba — sine + 4th harmonic, woody quick decay
  marimba(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m);
    const g = c.createGain(); g.connect(dest);
    const peak = n.v * 0.55;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    const o1 = mkOsc(c, t, freq, 'sine', g, session);
    const og = c.createGain(); og.gain.value = 0.18; og.connect(g);
    const o2 = mkOsc(c, t, freq * 4, 'sine', og, session);
    o1.stop(t + 0.5); o2.stop(t + 0.5);
  },
  // 808 bass — pitch-gliding sine sub with soft saturation
  bass808(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    const sh = c.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    sh.curve = curve;
    const g = c.createGain(); o.connect(sh); sh.connect(g); g.connect(dest);
    const peak = n.v * 0.9;
    const tail = Math.max(0.5, tr.release ?? 1.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.setValueAtTime(peak, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail);
    o.start(t); o.stop(t + dur + tail + 0.1); session.sources.push(o);
  },
  // Square lead — bright, vibrato, cuts through a mix
  lead(c, dest, tr, n, t, spb, session) {
    const freq = midiToFreq(n.m), dur = Math.max(0.05, n.d * spb);
    const g = c.createGain(); g.connect(dest);
    const atk = Math.max(0.005, tr.attack ?? 0.01), rel = Math.max(0.05, tr.release ?? 0.3);
    const peak = n.v * 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + dur);
    g.gain.setTargetAtTime(0.0001, t + atk + dur, rel / 3);
    const o1 = mkOsc(c, t, freq, 'square', g, session, -4);
    const o2 = mkOsc(c, t, freq, 'square', g, session, 4);
    const stopAt = t + atk + dur + rel + 0.3;
    o1.stop(stopAt); o2.stop(stopAt);
    vibLFO(c, t + 0.08, 8, 5.5, [o1.detune, o2.detune], session);
  },
};

// Sound-effect tracks — preset-driven, tuned by note pitch, vel = intensity
function sfxHit(c, dest, tr, n, t, spb, session) {
  const preset = tr.preset || 'Riser';
  const freq = midiToFreq(n.m);
  const vel = Math.max(0.1, n.v);
  const dur = Math.max(0.25, n.d * spb);
  switch (preset) {
    case 'Riser': {
      playNoise(c, t, dur, 'bandpass', 300, 8000 * vel, 0.5 * vel, dest, session);
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * (2 + vel * 3), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 * vel, t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.1); session.sources.push(o);
      break;
    }
    case 'Impact': {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
      const g = c.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.35); session.sources.push(o);
      playNoise(c, t, 0.35, 'lowpass', 900, 200, 0.5 * vel, dest, session);
      break;
    }
    case 'Whoosh': {
      playNoise(c, t, dur, 'bandpass', 6000, 300, 0.45 * vel, dest, session);
      break;
    }
    case 'Sub drop': {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(Math.max(40, freq), t);
      o.frequency.exponentialRampToValueAtTime(22, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.8 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.3); session.sources.push(o);
      break;
    }
    case 'Tape stop': {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(15, freq * 0.02), t + dur);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4000;
      const g = c.createGain();
      g.gain.setValueAtTime(0.4 * vel, t);
      g.gain.setValueAtTime(0.4 * vel, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.1); session.sources.push(o);
      break;
    }
    case 'Vinyl crackle': {
      // hiss bed + random pops across the note duration
      playNoise(c, t, dur, 'highpass', 6000, 6000, 0.05 * vel, dest, session);
      const pops = Math.floor(dur * 28);
      for (let i = 0; i < pops; i++) {
        const pt = t + Math.random() * dur;
        if (pt < t) continue;
        playNoise(c, pt, 0.008, 'highpass', 7000, 7000, (0.15 + Math.random() * 0.35) * vel, dest, session);
      }
      break;
    }
    case 'Zap': {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq * 8, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.16);
      const g = c.createGain();
      g.gain.setValueAtTime(0.5 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.2); session.sources.push(o);
      break;
    }
  }
}

function synthNote(c, dest, tr, n, t, spb, session) {
  // dedicated instrument voices take precedence over the generic synth path
  if (VOICES[tr.kind]) { VOICES[tr.kind](c, dest, tr, n, t, spb, session); return; }
  const dur = Math.max(0.05, n.d * spb);
  const freq = midiToFreq(n.m);
  const oscs = [];
  const mkOsc = (detune) => {
    const o = c.createOscillator(); o.type = tr.osc || 'saw';
    o.frequency.value = freq; o.detune.value = detune;
    session.sources.push(o); return o;
  };
  const mix = c.createGain(); mix.gain.value = 1;
  mix.connect(dest);
  if (tr.kind === 'pad') {
    const a = mkOsc(-7), b = mkOsc(7); a.connect(mix); b.connect(mix); oscs.push(a, b);
  } else {
    const o = mkOsc(0); o.connect(mix); oscs.push(o);
  }
  const filter = c.createBiquadFilter(); filter.type = 'lowpass';
  filter.frequency.value = Math.max(120, Math.min(12000, tr.cutoff * (0.45 + n.v)));
  filter.Q.value = tr.kind === 'bass' ? 6 : 1;
  mix.disconnect(); mix.connect(filter); filter.connect(dest);
  const g = c.createGain();
  const atk = tr.attack ?? 0.01, rel = tr.release ?? 0.25;
  const peak = n.v * (tr.kind === 'bass' ? 0.9 : tr.kind === 'pad' ? 0.32 : 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + Math.max(0.005, atk));
  const tail = tr.kind === 'pluck' ? Math.min(rel, 0.35) : Math.max(rel, 0.08);
  g.gain.setTargetAtTime(0.0001, t + atk + dur, tail / 3);
  mix.disconnect(); mix.connect(g); g.connect(filter);
  oscs.forEach(o => { o.start(t); o.stop(t + atk + dur + tail + 0.2); });
}

// schedule a full pass of the score into dest (live or offline). t0 = context time of beat 0.
function schedulePass(c, dest, score, t0, session) {
  const spb = 60 / score.bpm;
  const beats = score.bars * 4;
  const solo = score.tracks.some(t => t.solo && !t.mute);
  const revNode = c.createConvolver(); revNode.buffer = impulseResponse(c);
  const revOut = c.createGain(); revOut.gain.value = 0.9;
  revNode.connect(revOut); revOut.connect(dest);
  for (const tr of score.tracks) {
    if (tr.mute || (solo && !tr.solo)) continue;
    const input = c.createGain();
    let node = input;
    if ((tr.drive || 0) > 0.02) {
      const sh = c.createWaveShaper(); const k = tr.drive * 60 + 1;
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
      sh.curve = curve; node.connect(sh); node = sh;
    }
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = tr.pan || 0; node.connect(pan); node = pan; }
    const vol = c.createGain(); vol.gain.value = tr.volume ?? 0.8;
    node.connect(vol); vol.connect(dest);
    if ((tr.delay || 0) > 0.02) {
      const send = c.createGain(); send.gain.value = tr.delay * 0.55; vol.connect(send);
      const dl = c.createDelay(4); dl.delayTime.value = Math.max(0.02, (tr.delayBeats || 0.75) * spb);
      const fb = c.createGain(); fb.gain.value = 0.38;
      dl.connect(fb); fb.connect(dl); dl.connect(dest); send.connect(dl);
    }
    if ((tr.reverb || 0) > 0.02) {
      const send = c.createGain(); send.gain.value = tr.reverb * 0.8; vol.connect(send); send.connect(revNode);
    }
    if (tr.kind === 'vocal') {
      const buf = tr.assetId ? vocalBuffers.get(tr.assetId) : null;
      if (buf) {
        const src = c.createBufferSource(); src.buffer = buf;
        src.connect(input); src.start(t0 + tr.startBeats * spb);
        session.sources.push(src);
      }
    } else if (tr.kind === 'drum') {
      for (const n of tr.notes) if (n.t < beats) drumHit(c, input, n.m, t0 + n.t * spb, n.v, session);
    } else if (tr.kind === 'sfx') {
      for (const n of tr.notes) if (n.t < beats) sfxHit(c, input, tr, n, t0 + n.t * spb, spb, session);
    } else {
      for (const n of tr.notes) if (n.t < beats) synthNote(c, input, tr, n, t0 + n.t * spb, spb, session);
    }
  }
}

// ---------------------------------------------------------------- live playback
let playSession = null, playTimer = null, playheadRAF = 0;
export function stopPlayback() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  if (playSession) {
    for (const s of playSession.sources) { try { s.stop(0); } catch { } }
    playSession = null;
  }
  if (playheadRAF) { cancelAnimationFrame(playheadRAF); playheadRAF = 0; }
}
export async function playScore(hooks, score, onPlayhead) {
  stopPlayback();
  await ensureVocalBuffers(hooks, score);
  const c = ensureCtx();
  const master = c.createGain(); master.gain.value = 0.9;
  const comp = c.createDynamicsCompressor();
  master.connect(comp); comp.connect(c.destination);
  const session = { sources: [] };
  playSession = session;
  const spb = 60 / score.bpm, total = score.bars * 4 * spb;
  let nextStart = c.currentTime + 0.06;
  schedulePass(c, master, score, nextStart, session);
  nextStart += total;
  const loop = true;
  playTimer = setInterval(() => {
    if (!loop || !playSession) return;
    if (c.currentTime > nextStart - total - 0.05 && c.currentTime > nextStart - 0.5) {
      schedulePass(c, master, score, nextStart, session);
      nextStart += total;
    }
  }, 60);
  const t0 = nextStart - total;
  const tick = () => {
    if (!playSession) return;
    const beat = ((c.currentTime - t0) / spb) % (score.bars * 4);
    onPlayhead?.(Math.max(0, beat));
    playheadRAF = requestAnimationFrame(tick);
  };
  tick();
  return () => stopPlayback();
}

// ---------------------------------------------------------------- offline render
export async function renderScore(hooks, score) {
  await ensureVocalBuffers(hooks, score);
  const spb = 60 / score.bpm;
  const beats = score.bars * 4;
  const sr = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil((beats * spb + 2.5) * sr), sr);
  const master = oc.createGain(); master.gain.value = 0.9;
  const comp = oc.createDynamicsCompressor();
  master.connect(comp); comp.connect(oc.destination);
  schedulePass(oc, master, score, 0, { sources: [] });
  return oc.startRendering();
}

// ---------------------------------------------------------------- UI
let hooks = null, ui = {};
const state = { scoreIdx: 0, selTrackId: null, lastDur: 1, drag: null };

export function initSoundStudio(h) {
  hooks = h;
  ui.shell = document.getElementById('ws-music');
  if (!ui.shell) return;
  ui.shell.innerHTML = `
    <div id="sound-shell">
      <div id="sound-top">
        <button class="btn primary" id="snd-play">Play</button>
        <button class="btn" id="snd-stop">Stop</button>
        <span id="snd-score-sel-wrap"></span>
        <label class="snd-lbl">BPM <input type="number" id="snd-bpm" min="20" max="300" step="1" style="width:52px"></label>
        <label class="snd-lbl">Bars <input type="number" id="snd-bars" min="1" max="128" step="1" style="width:48px"></label>
        <label class="snd-lbl">Key <select id="snd-root"></select></label>
        <label class="snd-lbl">Scale <select id="snd-scale"></select></label>
        <label class="snd-lbl">Style <select id="snd-style"></select></label>
        <span class="spacer"></span>
        <button class="btn" id="snd-tomovie" title="Render to WAV and place on the movie timeline">Add to movie</button>
        <button class="btn" id="snd-download" title="Render to WAV and download">Download WAV</button>
      </div>
      <div id="sound-body">
        <aside id="sound-tracks"><div class="side-title">Tracks</div><div id="snd-tracklist"></div>
          <div class="side-title" style="margin-top:10px">Add track</div>
          <div id="snd-addtracks"></div>
        </aside>
        <div id="sound-rollwrap"><canvas id="sound-roll"></canvas></div>
        <aside id="sound-insp"><div class="side-title">Track</div><div id="snd-insp-body"></div></aside>
      </div>
    </div>`;
  // score selector + transport
  const rootSel = ui.shell.querySelector('#snd-root');
  NOTE_NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; rootSel.appendChild(o); });
  const scaleSel = ui.shell.querySelector('#snd-scale');
  Object.keys(SCALES).forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; scaleSel.appendChild(o); });
  const styleSel = ui.shell.querySelector('#snd-style');
  styleSel.appendChild(new Option('Choose style…', ''));
  Object.keys(STYLES).forEach(s => styleSel.appendChild(new Option(s + ' template', s)));
  styleSel.addEventListener('change', () => {
    const s = activeScore(); if (!s || !styleSel.value) { styleSel.value = ''; return; }
    applyStyle(s, styleSel.value);
    state.selTrackId = s.tracks[0]?.id || null;
    hooks.markDirty(); renderSoundStudio();
    hooks.toast(styleSel.value + ' arrangement loaded — tweak anything you like');
    styleSel.value = '';
  });
  ui.shell.querySelector('#snd-play').addEventListener('click', async () => {
    const score = activeScore(); if (!score) return;
    ui.shell.querySelector('#snd-play').textContent = 'Playing…';
    await playScore(hooks, score, (beat) => { if (state.playing) draw(); state.playBeat = beat; });
    state.playing = true; draw();
  });
  ui.shell.querySelector('#snd-stop').addEventListener('click', () => {
    stopPlayback(); state.playing = false; state.playBeat = -1;
    ui.shell.querySelector('#snd-play').textContent = 'Play'; draw();
  });
  ui.shell.querySelector('#snd-bpm').addEventListener('change', e => { const s = activeScore(); if (s) { s.bpm = +e.target.value || 120; hooks.markDirty(); } });
  ui.shell.querySelector('#snd-bars').addEventListener('change', e => { const s = activeScore(); if (s) { s.bars = Math.max(1, Math.round(+e.target.value || 16)); hooks.markDirty(); draw(); } });
  rootSel.addEventListener('change', e => { const s = activeScore(); if (s) { s.root = 60 + (+e.target.value); hooks.markDirty(); draw(); } });
  scaleSel.addEventListener('change', e => { const s = activeScore(); if (s) { s.scale = e.target.value; hooks.markDirty(); draw(); } });
  ui.shell.querySelector('#snd-tomovie').addEventListener('click', async () => {
    const score = activeScore(); if (!score || !score.tracks.length) { hooks.toast('Add some notes first'); return; }
    hooks.toast('Rendering score…');
    const buf = await renderScore(hooks, score);
    const blob = encodeWav(buf);
    hooks.addScoreToMovie(blob, score.name, buf.duration);
  });
  ui.shell.querySelector('#snd-download').addEventListener('click', async () => {
    const score = activeScore(); if (!score || !score.tracks.length) { hooks.toast('Add some notes first'); return; }
    const buf = await renderScore(hooks, score);
    const url = URL.createObjectURL(encodeWav(buf));
    const a = document.createElement('a'); a.href = url; a.download = (score.name || 'score').replace(/[^\w\- ]+/g, '') + '.wav'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  // canvas
  ui.canvas = ui.shell.querySelector('#sound-roll');
  ui.canvas.addEventListener('pointerdown', onPointerDown);
  ui.canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  ui.canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (document.getElementById('ws-music')?.classList.contains('active') && (e.key === 'Delete' || e.key === 'Backspace')) {
      const tr = selTrack(); const s = activeScore();
      if (tr && s && tr.kind !== 'vocal' && state.lastNote && tr.notes.includes(state.lastNote)) {
        tr.notes = tr.notes.filter(n => n !== state.lastNote);
        state.lastNote = null; hooks.markDirty(); renderInspector(); draw();
      }
    }
  });
  new ResizeObserver(() => draw()).observe(ui.shell.querySelector('#sound-rollwrap'));
  renderSoundStudio();
}

const scores = () => hooks.getScores();
function activeScore() { const all = scores(); return all[Math.min(state.scoreIdx, all.length - 1)]; }
function selTrack() { const s = activeScore(); return s?.tracks.find(t => t.id === state.selTrackId) || null; }

export function renderSoundStudio() {
  if (!ui.shell) return;
  const all = scores();
  if (!all.length) {
    all.push(normalizeScore({ name: 'Main theme', tracks: [makeTrack('drum'), makeTrack('bass'), makeTrack('synth')] }));
    hooks.markDirty();
  }
  const score = activeScore();
  // score selector
  const selWrap = ui.shell.querySelector('#snd-score-sel-wrap');
  selWrap.innerHTML = '';
  const sel = document.createElement('select'); sel.className = 'btn studio-select';
  all.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.name; if (i === state.scoreIdx) o.selected = true; sel.appendChild(o); });
  sel.addEventListener('change', () => { state.scoreIdx = +sel.value; state.selTrackId = null; renderSoundStudio(); });
  const add = document.createElement('button'); add.className = 'btn'; add.textContent = '+';
  add.title = 'New score';
  add.addEventListener('click', () => { all.push(normalizeScore({ name: 'Score ' + (all.length + 1), tracks: [makeTrack('drum'), makeTrack('synth')] })); state.scoreIdx = all.length - 1; hooks.markDirty(); renderSoundStudio(); });
  selWrap.append(sel, add);
  ui.shell.querySelector('#snd-bpm').value = score.bpm;
  ui.shell.querySelector('#snd-bars').value = score.bars;
  ui.shell.querySelector('#snd-root').value = ((score.root % 12) + 12) % 12;
  ui.shell.querySelector('#snd-scale').value = score.scale;
  if (!score.tracks.some(t => t.id === state.selTrackId)) state.selTrackId = score.tracks[0]?.id || null;
  renderTrackList(); renderInspector(); draw();
}

export function makeTrack(kind) {
  const names = {
    synth: 'Lead synth', bass: 'Bass synth', bass808: '808 bass', pad: 'Pad', pluck: 'Pluck',
    piano: 'Piano', epiano: 'Electric piano', organ: 'Organ', guitar: 'Guitar', strings: 'Strings',
    brass: 'Brass', flute: 'Flute', bell: 'Bell', marimba: 'Marimba', drum: 'Drums', sfx: 'Sound FX', vocal: 'Vocals',
  };
  const t = normalizeScore({ tracks: [{ kind, name: names[kind] }] }).tracks[0];
  const set = (p) => Object.assign(t, p);
  switch (kind) {
    case 'pad': set({ attack: 0.4, release: 1.2, cutoff: 1400 }); break;
    case 'bass': set({ osc: 'saw', cutoff: 700, attack: 0.005, release: 0.15 }); break;
    case 'bass808': set({ attack: 0.002, release: 1.1, cutoff: 3000, drive: 0.25 }); break;
    case 'pluck': set({ osc: 'triangle', release: 0.4 }); break;
    case 'lead': set({ osc: 'square', release: 0.3 }); break;
    case 'piano': set({ release: 0.9, cutoff: 8000 }); break;
    case 'epiano': set({ release: 1.4, cutoff: 6000, reverb: 0.3 }); break;
    case 'organ': set({ attack: 0.02, release: 0.1, cutoff: 5000 }); break;
    case 'guitar': set({ release: 0.7, cutoff: 5000 }); break;
    case 'strings': set({ attack: 0.35, release: 1.0, cutoff: 3800, reverb: 0.45 }); break;
    case 'brass': set({ attack: 0.06, release: 0.35, cutoff: 4200 }); break;
    case 'flute': set({ attack: 0.09, release: 0.4, cutoff: 6000, reverb: 0.3 }); break;
    case 'bell': set({ release: 2.2, cutoff: 9000, reverb: 0.4 }); break;
    case 'marimba': set({ release: 0.5, cutoff: 8000 }); break;
    case 'drum': t.notes = fourOnFloor(); break;
    case 'sfx': set({ preset: 'Riser', release: 1.5 }); break;
  }
  return t;
}
function fourOnFloor() {
  const notes = [];
  for (let b = 0; b < 16; b++) {
    notes.push({ t: b, d: 0.25, m: 0, v: 0.9 });                    // kick every beat
    if (b % 2 === 1) notes.push({ t: b, d: 0.25, m: 2, v: 0.5 });   // hats
    if (b % 4 === 2) notes.push({ t: b, d: 0.25, m: 1, v: 0.8 });   // snare
  }
  return notes;
}

// ---------------------------------------------------------------- genre styles
// One click = a full DAW-style arrangement. Patterns tile per bar; melodic
// tracks use scale degrees so everything stays in the score's key.
export const STYLES = {
  'Hip-hop': {
    bpm: 88, bars: 16, root: 41, scale: 'Natural minor',
    build(score) {
      const dr = makeTrack('drum');
      dr.notes = tile([[0, 0.25, 8], [0.75, 0.25, 8], [1, 0.25, 2], [2, 0.25, 1], [3, 0.5, 1], [3.5, 0.25, 9], [3.75, 0.25, 11]], score.bars);
      const b808 = makeTrack('bass808');
      b808.notes = mel(score, [[0, 1.5, 0], [1.5, 0.5, 0], [2, 1, 0], [3, 0.5, -3], [3.5, 0.5, -2]]);
      const keys = makeTrack('epiano');
      keys.notes = chord(score, [[0, 2, [0, 2, 4, 6]], [2, 2, [-3, -1, 1]]], 1);
      const vinyl = makeTrack('sfx'); vinyl.preset = 'Vinyl crackle';
      vinyl.notes = [{ t: 0, d: 4, m: 60, v: 0.7 }];
      return [dr, b808, keys, vinyl];
    },
  },
  'EDM': {
    bpm: 128, bars: 16, root: 45, scale: 'Natural minor',
    build(score) {
      const dr = makeTrack('drum');
      dr.notes = tile([[0, 0.25, 0], [1, 0.25, 0], [2, 0.25, 0], [3, 0.25, 0], [0.5, 0.25, 3], [1.5, 0.25, 3], [2.5, 0.25, 3], [3.5, 0.25, 3], [2, 0.25, 1]], score.bars);
      const bass = makeTrack('bass');
      bass.notes = mel(score, [[0, 0.5, 0], [0.75, 0.25, 0], [1.5, 0.5, 0], [2.25, 0.25, 0], [3, 0.5, 3], [3.5, 0.5, 2]]);
      const plk = makeTrack('pluck');
      plk.notes = arpStyle(score, [0, 2, 4, 2], 0.5);
      const pad = makeTrack('pad');
      pad.notes = chord(score, [[0, 4, [0, 2, 4]], [4, 4, [5, 7, 9]], [8, 4, [3, 5, 7]], [12, 4, [4, 6, 8]]]);
      const riser = makeTrack('sfx'); riser.preset = 'Riser';
      riser.notes = [{ t: 28, d: 4, m: 69, v: 0.8 }, { t: 60, d: 4, m: 69, v: 0.8 }];
      return [dr, bass, plk, pad, riser];
    },
  },
  'Horror': {
    bpm: 70, bars: 8, root: 36, scale: 'Harmonic minor',
    build(score) {
      const drone = makeTrack('strings');
      drone.notes = [{ t: 0, d: 8, m: degMidi(score, 0, 0), v: 0.7 }, { t: 8, d: 8, m: degMidi(score, 0, 0), v: 0.75 }, { t: 16, d: 8, m: degMidi(score, 4, 0), v: 0.7 }, { t: 24, d: 8, m: degMidi(score, 0, 0), v: 0.8 }];
      const bell = makeTrack('bell');
      bell.notes = mel(score, [[0, 1, 6], [3, 0.5, 5], [6, 1, 7], [10, 0.5, 6], [12, 2, 4], [16, 1, 6], [19, 0.5, 5], [22, 1, 7], [26, 0.5, 6], [28, 2, 4]]);
      const heart = makeTrack('drum');
      heart.notes = tile([[0, 0.25, 0], [0.5, 0.25, 0]], score.bars);
      const imp = makeTrack('sfx'); imp.preset = 'Impact';
      imp.notes = [{ t: 0, d: 2, m: 40, v: 0.9 }, { t: 16, d: 2, m: 40, v: 0.9 }];
      const sub = makeTrack('sfx'); sub.preset = 'Sub drop';
      sub.notes = [{ t: 8, d: 3, m: 45, v: 0.6 }];
      return [drone, bell, heart, imp, sub];
    },
  },
  'Lofi': {
    bpm: 82, bars: 16, root: 43, scale: 'Dorian',
    build(score) {
      const dr = makeTrack('drum');
      dr.notes = tile([[0, 0.25, 0], [0.75, 0.25, 0], [2, 0.25, 1], [3, 0.25, 11], [3.5, 0.25, 2]], score.bars);
      const keys = makeTrack('epiano');
      keys.notes = chord(score, [[0, 3.5, [0, 2, 4, 6]], [4, 3.5, [1, 3, 5]], [8, 3.5, [-2, 0, 2]], [12, 3.5, [-1, 1, 3]]]);
      const bass = makeTrack('bass');
      bass.notes = mel(score, [[0, 1.5, 0], [2, 1, 0], [3, 0.5, 2], [4, 1.5, 1], [6, 1, 1], [7, 0.5, 0]]);
      const vinyl = makeTrack('sfx'); vinyl.preset = 'Vinyl crackle';
      vinyl.notes = [{ t: 0, d: 4, m: 60, v: 0.6 }];
      return [dr, keys, bass, vinyl];
    },
  },
  'Cinematic': {
    bpm: 90, bars: 16, root: 45, scale: 'Natural minor',
    build(score) {
      const ostinato = makeTrack('strings');
      ostinato.notes = arpStyle(score, [0, 0, 4, 0, 2, 0, 4, 0], 0.5, 1);
      const melody = makeTrack('brass');
      melody.notes = mel(score, [[0, 2, 4], [2, 1, 2], [4, 2, 0], [6, 1, 2], [8, 3, 4], [12, 2, 2], [14, 1, 0], [16, 4, 7]]);
      const piano = makeTrack('piano');
      piano.notes = chord(score, [[0, 4, [0, 2, 4]], [4, 4, [-3, -1, 1]], [8, 4, [2, 4, 6]], [12, 4, [1, 3, 5]]]);
      const timp = makeTrack('drum');
      timp.notes = tile([[0, 0.5, 5], [2, 0.5, 5], [3, 0.25, 5]], score.bars);
      const imp = makeTrack('sfx'); imp.preset = 'Impact';
      imp.notes = [{ t: 0, d: 2, m: 40, v: 0.8 }, { t: 32, d: 2, m: 40, v: 0.9 }];
      return [ostinato, melody, piano, timp, imp];
    },
  },
  'Pop': {
    bpm: 112, bars: 16, root: 60, scale: 'Major',
    build(score) {
      const dr = makeTrack('drum');
      dr.notes = tile([[0, 0.25, 0], [1, 0.25, 0], [2, 0.25, 1], [3, 0.25, 0], [3.5, 0.25, 0], [0.5, 0.25, 2], [1.5, 0.25, 2], [2.5, 0.25, 2], [3.25, 0.25, 2]], score.bars);
      const bass = makeTrack('bass');
      bass.notes = mel(score, [[0, 0.75, 0], [0.75, 0.25, 0], [1, 0.75, 4], [2, 0.75, 4], [3, 0.5, 5], [3.5, 0.5, 4]]);
      const keys = makeTrack('piano');
      keys.notes = chord(score, [[0, 2, [0, 2, 4]], [2, 2, [3, 5, 7]], [4, 2, [4, 6, 8]], [6, 2, [3, 5, 7]]]);
      const lead = makeTrack('lead');
      lead.notes = mel(score, [[0, 0.5, 4], [0.5, 0.5, 4], [1, 1, 5], [2, 0.5, 4], [2.5, 0.5, 2], [3, 1, 0], [4, 0.5, 4], [4.5, 0.5, 4], [5, 1, 5], [6, 0.5, 7], [7, 1, 5]]);
      const pad = makeTrack('pad');
      pad.notes = chord(score, [[0, 8, [0, 2, 4]], [8, 8, [-1, 1, 3]]]);
      return [dr, bass, keys, lead, pad];
    },
  },
  'Rock': {
    bpm: 120, bars: 16, root: 40, scale: 'Mixolydian',
    build(score) {
      const dr = makeTrack('drum');
      dr.notes = tile([[0, 0.25, 0], [1, 0.25, 0], [2, 0.25, 1], [3, 0.25, 0], [0.5, 0.25, 10], [2.5, 0.25, 10]], score.bars);
      const gtr = makeTrack('guitar');
      gtr.notes = chord(score, [[0, 2, [0, 0, 4]], [2, 2, [5, 5, 0]], [4, 2, [0, 0, 4]], [6, 2, [3, 3, 6]]], 0);
      const bass = makeTrack('bass');
      bass.notes = mel(score, [[0, 0.5, 0], [1, 0.5, 0], [1.5, 0.5, 0], [2, 0.5, 5], [3, 0.5, 5], [3.5, 0.5, 3]], -1);
      const organ = makeTrack('organ');
      organ.notes = chord(score, [[0, 4, [0, 2, 4]], [4, 4, [5, 7, 9]]]);
      return [dr, gtr, bass, organ];
    },
  },
};

// scale degree → midi (handles degrees beyond one octave, negative too)
function degMidi(score, deg, oct = 0) {
  const steps = SCALES[score.scale] || SCALES['Chromatic'];
  const o = Math.floor(deg / steps.length);
  const idx = ((deg % steps.length) + steps.length) % steps.length;
  return Math.max(0, Math.min(120, score.root + 12 * (oct + o) + steps[idx]));
}
// tile a one-bar drum pattern across the whole score
function tile(pat, bars) {
  const out = [];
  for (let bar = 0; bar < bars; bar++)
    for (const [t, d, m, v] of pat) out.push({ t: bar * 4 + t, d, m, v: v ?? 0.8 });
  return out;
}
// melodic line from [beat, dur, degree, oct?, vel?]
function mel(score, pat, oct = 0) {
  return pat.map(([t, d, deg, o, v]) => ({ t, d, m: degMidi(score, deg, o ?? oct), v: v ?? 0.8 }));
}
// chords from [beat, dur, degrees[]]
function chord(score, pat, oct = 0) {
  const out = [];
  for (const [t, d, degs] of pat)
    for (const deg of degs) out.push({ t, d, m: degMidi(score, deg, oct), v: 0.65 });
  return out;
}
// arpeggio: cycle degrees every `step` beats
function arpStyle(score, degs, step, oct = 0) {
  const out = [];
  const total = score.bars * 4;
  for (let i = 0, b = 0; b < total; b += step, i++)
    out.push({ t: b, d: step, m: degMidi(score, degs[i % degs.length], oct), v: 0.75 });
  return out;
}

export function applyStyle(score, name) {
  const st = STYLES[name];
  if (!st || !score) return false;
  score.bpm = st.bpm; score.bars = st.bars; score.root = st.root; score.scale = st.scale;
  score.tracks = st.build(score);
  return true;
}

function renderTrackList() {
  const score = activeScore(); const list = ui.shell.querySelector('#snd-tracklist');
  list.innerHTML = '';
  score.tracks.forEach(tr => {
    const row = document.createElement('div'); row.className = 'list-item' + (tr.id === state.selTrackId ? ' selected' : '');
    const dot = document.createElement('span'); dot.className = 'nm'; dot.style.color = KIND_COLORS[tr.kind];
    dot.textContent = (tr.mute ? '🔇 ' : tr.solo ? '🎧 ' : '') + tr.name;
    const meta = document.createElement('span'); meta.className = 'meta';
    const mut = document.createElement('span'); mut.textContent = 'M'; mut.title = 'Mute';
    mut.addEventListener('click', e => { e.stopPropagation(); tr.mute = !tr.mute; hooks.markDirty(); renderTrackList(); });
    const sol = document.createElement('span'); sol.textContent = 'S'; sol.title = 'Solo';
    sol.addEventListener('click', e => { e.stopPropagation(); tr.solo = !tr.solo; hooks.markDirty(); renderTrackList(); });
    const del = document.createElement('span'); del.textContent = '✕'; del.title = 'Delete track';
    del.addEventListener('click', e => { e.stopPropagation(); score.tracks = score.tracks.filter(x => x !== tr); if (state.selTrackId === tr.id) state.selTrackId = null; hooks.markDirty(); renderSoundStudio(); });
    meta.append(mut, sol, del);
    dot.addEventListener('click', () => { state.selTrackId = tr.id; renderTrackList(); renderInspector(); draw(); });
    row.append(dot, meta); list.appendChild(row);
  });
  const addWrap = ui.shell.querySelector('#snd-addtracks');
  addWrap.innerHTML = '';
  const menu = document.createElement('select');
  menu.className = 'btn studio-select'; menu.style.width = '100%'; menu.style.marginBottom = '6px';
  menu.setAttribute('aria-label', 'Add a track');
  INSTRUMENT_KINDS.forEach(([kind, label]) => menu.appendChild(new Option(label, kind)));
  const addBtn = document.createElement('button');
  addBtn.className = 'btn primary'; addBtn.textContent = '+ Add track'; addBtn.style.width = '100%';
  addBtn.addEventListener('click', () => {
    const score = activeScore(); if (!score) return;
    const kind = menu.value;
    if (kind === 'vocal') {
      const tr = makeTrack('vocal'); tr.notes = [];
      score.tracks.push(tr); state.selTrackId = tr.id; hooks.markDirty(); renderSoundStudio();
      toastInStudio('Vocal track added — use Record in the Track panel');
      return;
    }
    score.tracks.push(makeTrack(kind)); state.selTrackId = score.tracks[score.tracks.length - 1].id;
    hooks.markDirty(); renderSoundStudio();
  });
  addWrap.append(menu, addBtn);
}
function toastInStudio(msg) { hooks.toast?.(msg); }

function slider(label, value, min, max, step, onInput, fmt) {
  const wrap = document.createElement('label'); wrap.className = 'joint-editor';
  const t = document.createElement('span'); t.className = 'side-title';
  const setT = () => { t.textContent = label + ': ' + (fmt ? fmt(value) : value); };
  setT();
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  inp.addEventListener('input', () => { value = +inp.value; setT(); onInput(value); });
  wrap.append(t, inp); return wrap;
}
function selectRow(label, value, options, onChange) {
  const wrap = document.createElement('label'); wrap.className = 'joint-editor';
  const t = document.createElement('span'); t.className = 'side-title'; t.textContent = label;
  const sel = document.createElement('select'); sel.className = 'btn studio-select';
  options.forEach(([v, text]) => { const o = document.createElement('option'); o.value = v; o.textContent = text; if (v === value) o.selected = true; sel.appendChild(o); });
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(t, sel); return wrap;
}

function renderInspector() {
  const body = ui.shell.querySelector('#snd-insp-body');
  body.innerHTML = '';
  const tr = selTrack(); if (!tr) { body.innerHTML = '<p class="studio-muted">Select a track.</p>'; return; }
  const nameWrap = document.createElement('label'); nameWrap.className = 'joint-editor';
  const nt = document.createElement('span'); nt.className = 'side-title'; nt.textContent = 'Name';
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.className = 'btn'; nameIn.value = tr.name;
  nameIn.addEventListener('change', () => { tr.name = nameIn.value.slice(0, 60) || 'Track'; hooks.markDirty(); renderTrackList(); });
  nameWrap.append(nt, nameIn); body.appendChild(nameWrap);
  body.appendChild(slider('Volume', tr.volume ?? 0.8, 0, 1.5, 0.05, v => { tr.volume = v; hooks.markDirty(); }, v => Math.round(v * 100) + '%'));
  body.appendChild(slider('Pan', tr.pan || 0, -1, 1, 0.05, v => { tr.pan = v; hooks.markDirty(); }, v => (v < 0 ? 'L' : v > 0 ? 'R' : '') + Math.abs(Math.round(v * 100))));
  const OSC_KINDS = ['synth', 'lead', 'bass', 'pad', 'pluck'];
  if (tr.kind === 'sfx') {
    body.appendChild(selectRow('Effect', tr.preset || 'Riser', SFX_PRESETS.map(p => [p, p]), v => { tr.preset = v; hooks.markDirty(); }));
    const hint = document.createElement('p'); hint.className = 'studio-muted';
    hint.textContent = 'Draw notes where the effects hit — pitch tunes them, drag height = velocity.';
    body.appendChild(hint);
  }
  if (OSC_KINDS.includes(tr.kind)) {
    body.appendChild(selectRow('Waveform', tr.osc, [['saw', 'Saw'], ['square', 'Square'], ['sine', 'Sine'], ['triangle', 'Triangle']], v => { tr.osc = v; hooks.markDirty(); }));
    body.appendChild(slider('Cutoff', tr.cutoff ?? 2200, 100, 9000, 50, v => { tr.cutoff = v; hooks.markDirty(); }, v => v + ' Hz'));
  }
  if (tr.kind !== 'drum' && tr.kind !== 'vocal') {
    body.appendChild(slider('Attack', tr.attack ?? 0.01, 0.005, 2, 0.005, v => { tr.attack = v; hooks.markDirty(); }, v => v.toFixed(2) + ' s'));
    body.appendChild(slider('Release', tr.release ?? 0.25, 0.03, 4, 0.01, v => { tr.release = v; hooks.markDirty(); }, v => v.toFixed(2) + ' s'));
  }
  body.appendChild(slider('Reverb', tr.reverb ?? 0.15, 0, 1, 0.05, v => { tr.reverb = v; hooks.markDirty(); }, v => Math.round(v * 100) + '%'));
  body.appendChild(slider('Delay', tr.delay ?? 0, 0, 1, 0.05, v => { tr.delay = v; hooks.markDirty(); }, v => Math.round(v * 100) + '%'));
  if (tr.delay > 0) body.appendChild(slider('Delay time (beats)', tr.delayBeats ?? 0.75, 0.1, 4, 0.05, v => { tr.delayBeats = v; hooks.markDirty(); }));
  body.appendChild(slider('Drive', tr.drive ?? 0, 0, 1, 0.05, v => { tr.drive = v; hooks.markDirty(); }, v => Math.round(v * 100) + '%'));
  if (tr.kind === 'vocal') {
    const recBtn = document.createElement('button'); recBtn.className = 'btn';
    recBtn.textContent = state.recording ? 'Stop recording' : 'Record from mic';
    recBtn.addEventListener('click', () => state.recording ? stopVocalRecording() : startVocalRecording(tr));
    body.appendChild(recBtn);
    const info = document.createElement('p'); info.className = 'studio-muted';
    info.textContent = tr.assetId ? 'A take is recorded — it plays with the score and saves with the movie.' : 'Record vocals or import a movie audio asset below.';
    body.appendChild(info);
  }
  if (tr.kind !== 'vocal' && tr.kind !== 'sfx') {
    const genTitle = document.createElement('div'); genTitle.className = 'side-title'; genTitle.textContent = 'Generate'; genTitle.style.marginTop = '8px';
    body.appendChild(genTitle);
    if (tr.kind === 'drum') {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Generate groove';
      b.addEventListener('click', () => { tr.notes = generateGroove(); hooks.markDirty(); draw(); });
      body.appendChild(b);
    } else {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Generate arpeggio in key';
      b.addEventListener('click', () => { tr.notes = generateArpeggio(activeScore(), tr); hooks.markDirty(); draw(); });
      body.appendChild(b);
      const b2 = document.createElement('button'); b2.className = 'btn'; b2.textContent = 'Generate melody in key';
      b2.addEventListener('click', () => { tr.notes = generateMelody(activeScore(), tr); hooks.markDirty(); draw(); });
      body.appendChild(b2);
    }
  }
  if (tr.kind !== 'vocal') {
    const clr = document.createElement('button'); clr.className = 'btn'; clr.textContent = 'Clear track';
    clr.addEventListener('click', () => { tr.notes = []; hooks.markDirty(); draw(); });
    body.appendChild(clr);
  }
}

// generators — everything stays in the score's key/scale
function generateGroove() {
  const notes = []; const r = Math.random;
  for (let b = 0; b < 16; b++) {
    if (true) notes.push({ t: b, d: 0.25, m: 0, v: 0.9 });
    if (b % 2 === 1 || r() < 0.15) notes.push({ t: b + 0.5, d: 0.25, m: 2, v: 0.4 + r() * 0.2 });
    if (b % 4 === 2) notes.push({ t: b, d: 0.25, m: 1, v: 0.85 });
    if (r() < 0.2) notes.push({ t: b, d: 0.25, m: 5, v: 0.6 });
    if (b === 0 || b === 8) notes.push({ t: b, d: 0.25, m: 6, v: 0.7 });
  }
  return notes;
}
function generateArpeggio(score, tr) {
  const notes = [];
  const set = [...scaleSet(score.root, score.scale)].filter(m => m >= score.root - 12 && m <= score.root + 24).sort((a, b) => a - b);
  if (!set.length) return notes;
  const patterns = ['up', 'down', 'updown'];
  const pat = patterns[Math.floor(Math.random() * patterns.length)];
  const n = set.length;
  for (let step = 0, b = 0; b < score.bars * 4; b += 0.5, step++) {
    let i;
    if (pat === 'up') i = step % n;
    else if (pat === 'down') i = (n - 1) - (step % n);
    else { const tri = 2 * n - 2 > 0 ? step % (2 * n - 2) : 0; i = tri < n ? tri : 2 * n - 2 - tri; }
    notes.push({ t: b, d: 0.5, m: set[i], v: 0.7 + Math.random() * 0.2 });
  }
  return notes;
}
function generateMelody(score, tr) {
  const notes = []; const set = [...scaleSet(score.root, score.scale)].filter(m => m >= score.root && m <= score.root + 16).sort((a, b) => a - b);
  let idx = Math.floor(set.length / 2);
  for (let b = 0; b < score.bars * 4;) {
    const d = [0.5, 0.5, 1, 1, 2][Math.floor(Math.random() * 5)];
    idx = Math.max(0, Math.min(set.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.25 ? 2 : 1)));
    if (Math.random() < 0.12) idx = Math.floor(set.length / 2); // return home
    notes.push({ t: b, d, m: set[idx], v: 0.6 + Math.random() * 0.3 });
    b += d;
  }
  return notes;
}

// ---------------------------------------------------------------- vocal recording
let mediaStream = null, mediaRec = null, recChunks = [], recTrack = null;
export async function startVocalRecording(tr) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toastInStudio('Microphone unavailable — allow mic access to record vocals');
    return;
  }
  recTrack = tr; recChunks = [];
  mediaRec = new MediaRecorder(mediaStream);
  mediaRec.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  mediaRec.onstop = async () => {
    mediaStream?.getTracks().forEach(t => t.stop());
    state.recording = false;
    const blob = new Blob(recChunks, { type: mediaRec.mimeType || 'audio/webm' });
    try {
      const arr = await blob.arrayBuffer();
      const buf = await ensureCtx().decodeAudioData(arr);
      const wav = encodeWav(buf);
      const dataURL = await blobToDataURL(wav);
      const asset = { id: 'aud_' + Math.random().toString(36).slice(2, 10), name: 'Vocal — ' + (recTrack.name || 'take'), dataURL, duration: buf.duration };
      hooks.addAudioAsset(asset); // no timeline clip — the score owns it
      recTrack.assetId = asset.id;
      vocalBuffers.set(asset.id, buf);
      hooks.markDirty(); renderInspector(); draw();
      toastInStudio('Vocal take saved to the score (' + buf.duration.toFixed(1) + 's)');
    } catch {
      toastInStudio('Recording failed to decode — try again');
    }
  };
  mediaRec.start();
  state.recording = true;
  renderInspector();
  toastInStudio('Recording… click Stop when done');
}
export function stopVocalRecording() {
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
}
function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

// ---------------------------------------------------------------- piano roll / grids
const GUTTER = 46, TOP_MIDI = 96, BOT_MIDI = 24, ROW_H = 16, DRUM_ROW_H = 30;
function layout(score) {
  const beats = score.bars * 4;
  const w = ui.canvas.parentElement.clientWidth - 2;
  return { beats, w, cellW: (w - GUTTER) / (beats * 4) };
}
export function draw() {
  if (!ui.canvas || !ui.shell || !ui.shell.classList.contains('active')) return;
  const score = activeScore(); if (!score) return;
  const tr = selTrack();
  const dpr = window.devicePixelRatio || 1;
  const { beats, w, cellW } = layout(score);
  const isDrum = tr?.kind === 'drum';
  const isVocal = tr?.kind === 'vocal';
  const rows = isDrum ? DRUMS.length : (TOP_MIDI - BOT_MIDI + 1);
  const rowH = isDrum ? DRUM_ROW_H : ROW_H;
  const h = rows * rowH;
  ui.canvas.width = w * dpr; ui.canvas.height = h * dpr;
  ui.canvas.style.width = w + 'px'; ui.canvas.style.height = h + 'px';
  const c = ui.canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#16130f'; c.fillRect(0, 0, w, h);
  const inScale = scaleSet(score.root, score.scale);
  // rows
  if (isDrum) {
    for (let i = 0; i < DRUMS.length; i++) {
      c.fillStyle = i % 2 ? '#1d1915' : '#191512'; c.fillRect(GUTTER, i * rowH, w - GUTTER, rowH);
    }
  } else {
    for (let m = BOT_MIDI; m <= TOP_MIDI; m++) {
      const y = (TOP_MIDI - m) * rowH;
      const black = NOTE_NAMES[m % 12].includes('#');
      c.fillStyle = inScale.has(m) ? (black ? '#24201a' : '#2a251d') : (black ? '#141110' : '#181511');
      c.fillRect(GUTTER, y, w - GUTTER, rowH);
    }
  }
  // grid lines
  for (let b = 0; b <= beats * 4; b++) {
    const x = GUTTER + b * cellW;
    c.strokeStyle = b % 16 === 0 ? '#4a4238' : b % 4 === 0 ? '#332e27' : '#241f1a';
    c.lineWidth = b % 16 === 0 ? 2 : 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  // gutter labels
  c.fillStyle = '#8a8177'; c.font = '10px sans-serif';
  if (isDrum) {
    DRUMS.forEach((d, i) => c.fillText(d, 4, i * rowH + rowH / 2 + 3));
  } else {
    for (let m = BOT_MIDI; m <= TOP_MIDI; m++) {
      if (m % 12 === 0) { const y = (TOP_MIDI - m) * rowH; c.fillStyle = '#b5a98f'; c.fillText(NOTE_NAMES[0] + (m / 12 - 1), 6, y + rowH - 4); }
    }
  }
  // notes
  if (tr) {
    if (isVocal) {
      const buf = tr.assetId ? vocalBuffers.get(tr.assetId) : null;
      if (buf) {
        const spb = 60 / score.bpm;
        const x0 = GUTTER + tr.startBeats * cellW * 4; // beats → x
        const wpx = buf.duration / spb * (cellW * 4);
        c.fillStyle = 'rgba(143, 209, 143, 0.5)';
        c.fillRect(x0, h * 0.15, wpx, h * 0.7);
        c.strokeStyle = '#8fd18f'; c.lineWidth = 1;
        c.beginPath();
        const data = buf.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / wpx));
        for (let x = 0; x < wpx; x++) {
          let min = 1, max = -1;
          for (let i = 0; i < step; i++) { const v = data[Math.min(data.length - 1, x * step + i)]; if (v < min) min = v; if (v > max) max = v; }
          const y1 = h / 2 - max * h * 0.35, y2 = h / 2 - min * h * 0.35;
          c.moveTo(x0 + x, y1); c.lineTo(x0 + x, y2);
        }
        c.stroke();
      } else {
        c.fillStyle = '#6f675e'; c.font = '13px sans-serif';
        c.fillText('Vocal track — record from the Track panel', GUTTER + 12, h / 2);
      }
    } else {
      c.fillStyle = KIND_COLORS[tr.kind] || '#4fb3a4';
      for (const n of tr.notes) {
        const x = GUTTER + n.t * cellW * 4;
        const y = isDrum ? n.m * rowH : (TOP_MIDI - n.m) * rowH;
        const nw = Math.max(3, n.d * cellW * 4 - 1);
        const nh = isDrum ? rowH - 6 : rowH - 2;
        c.globalAlpha = 0.35 + n.v * 0.65;
        c.fillRect(x + 1, y + 1, nw, nh);
        c.globalAlpha = 1;
      }
    }
  }
  // playhead
  if (state.playing && state.playBeat >= 0) {
    const px = GUTTER + state.playBeat * cellW * 4;
    c.strokeStyle = '#f2b25c'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(px, 0); c.lineTo(px, h); c.stroke();
  }
}

function pointToNote(e) {
  const score = activeScore(); const tr = selTrack();
  const rect = ui.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const { cellW } = layout(score);
  const beat = Math.max(0, Math.round((x - GUTTER) / (cellW * 4) * 4) / 4);
  const row = Math.floor(y / (tr.kind === 'drum' ? DRUM_ROW_H : ROW_H));
  const midi = tr.kind === 'drum' ? row : TOP_MIDI - row;
  return { x, y, beat, midi };
}
function onPointerDown(e) {
  const score = activeScore(); const tr = selTrack();
  if (!score || !tr || tr.kind === 'vocal') return;
  const p = pointToNote(e);
  if (p.x < GUTTER) { // audition from gutter
    if (tr.kind !== 'drum' && p.midi >= BOT_MIDI && p.midi <= TOP_MIDI) audition(tr, p.midi);
    return;
  }
  if (tr.kind === 'drum') {
    if (p.midi < 0 || p.midi >= DRUMS.length) return;
    const ex = tr.notes.find(n => n.t === p.beat && n.m === p.midi);
    if (ex) tr.notes = tr.notes.filter(n => n !== ex);
    else { tr.notes.push({ t: p.beat, d: 0.25, m: p.midi, v: e.shiftKey ? 1 : 0.9 }); audition(tr, p.midi); }
    hooks.markDirty(); draw(); return;
  }
  const hit = tr.notes.find(n => p.midi === n.m && p.beat >= n.t - 0.001 && p.beat <= n.t + n.d);
  if (e.button === 2 || e.altKey) { // remove
    if (hit) { tr.notes = tr.notes.filter(n => n !== hit); hooks.markDirty(); draw(); }
    return;
  }
  if (hit) {
    const noteEndX = GUTTER + (hit.t + hit.d) * layout(score).cellW * 4;
    const resize = p.x > noteEndX - 10;
    state.drag = { note: hit, mode: resize ? 'resize' : 'move', offT: p.beat - hit.t, moved: false };
    state.lastNote = hit;
    audition(tr, hit.m);
  } else {
    const n = { t: p.beat, d: state.lastDur || 1, m: p.midi, v: 0.8 };
    tr.notes.push(n);
    state.drag = { note: n, mode: 'move', offT: 0, moved: false };
    audition(tr, p.midi);
    hooks.markDirty(); draw();
  }
}
function onPointerMove(e) {
  if (!state.drag) return;
  const tr = selTrack(); const p = pointToNote(e);
  const n = state.drag.note;
  if (state.drag.mode === 'move') {
    const nt = Math.max(0, p.beat - state.drag.offT);
    if (Math.abs(nt - n.t) > 0.001 || p.midi !== n.m) state.drag.moved = true;
    n.t = Math.round(nt * 4) / 4; n.m = p.midi;
  } else {
    const d = Math.max(0.25, Math.round((p.beat - n.t) * 4) / 4);
    if (d !== n.d) state.drag.moved = true;
    n.d = d; state.lastDur = d;
  }
  draw();
}
function onPointerUp() {
  if (state.drag) { if (state.drag.moved) hooks.markDirty(); state.drag = null; }
}
function audition(tr, midi) {
  const c = ensureCtx();
  const g = c.createGain(); g.connect(c.destination);
  if (tr.kind === 'drum') { drumHit(c, c.destination, midi, c.currentTime, 0.9, { sources: [] }); return; }
  const session = { sources: [] };
  synthNote(c, g, tr, { t: 0, d: 0.3, m: midi, v: 0.8 }, c.currentTime, 0.25, session);
}

export function onShowSoundStudio() { draw(); }
export function onHideSoundStudio() { stopPlayback(); state.playing = false; state.playBeat = -1; }
