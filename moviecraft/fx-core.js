// Cinematic FX core: kind presets + deterministic age math shared by the
// shader, the props panel and the tests. Pure data & functions — no THREE.
// Every particle is a pure function of (seed, t) — no simulation state —
// so scrubbing backwards, playing and frame-accurate export all produce
// identical frames. Effects are scene objects: they transform, keyframe,
// save and export like any other object.
export const FX_KINDS = ['fire', 'smoke', 'sparks', 'explosion', 'fountain', 'rain', 'snow', 'embers', 'magic', 'dust', 'fireworks', 'lightning', 'portal', 'hearts', 'stars'];
export const FX_LABELS = {
  fire: 'Fire', smoke: 'Smoke', sparks: 'Sparks', explosion: 'Explosion', fountain: 'Fountain',
  rain: 'Rain', snow: 'Snow', embers: 'Embers', magic: 'Magic', dust: 'Dust', fireworks: 'Fireworks',
  lightning: 'Lightning', portal: 'Portal', hearts: 'Hearts', stars: 'Stars',
};

// Per-kind look: velocity, physics and colour ramp shared by the shader.
export const FX_PRESETS = {
  fire:     { life: 1.1, count: 260, size: 0.55, vel: [0.32, 2.3, 0.32], gravity: 0.6, spread: 0.35, grow: 1.6, turb: 0.35, additive: true, oneShot: false, colors: ['#ffdca8', '#ff9a3c', '#c93010'] },
  smoke:    { life: 3.4, count: 170, size: 1.15, vel: [0.55, 0.85, 0.55], gravity: 0.12, spread: 0.8, grow: 2.4, turb: 0.5, additive: false, oneShot: false, colors: ['#565460', '#3c3a44', '#26252c'] },
  sparks:   { life: 0.9, count: 150, size: 0.09, vel: [1.6, 3.4, 1.6], gravity: -7.5, spread: 1.0, grow: 0.2, turb: 0.08, additive: true, oneShot: false, colors: ['#fff3c4', '#ffca6e', '#ff5f1e'] },
  explosion:{ life: 1.5, count: 460, size: 0.75, vel: [3.4, 2.6, 3.4], gravity: -3.2, spread: 1.0, grow: 1.1, turb: 0.22, additive: true, oneShot: true, colors: ['#fff6d8', '#ffb24a', '#b3300c'] },
  fountain: { life: 1.7, count: 320, size: 0.14, vel: [0.7, 5.2, 0.7], gravity: -9.0, spread: 0.22, grow: 0.1, turb: 0.05, additive: true, oneShot: false, colors: ['#eafffb', '#7fe3d4', '#2fa8c9'] },
  rain:     { life: 0.6, count: 420, size: 0.05, vel: [0.4, -13.0, 0.4], gravity: -1.5, spread: 0.95, grow: 0.0, turb: 0.04, additive: false, oneShot: false, colors: ['#cfe4f7', '#9fc6e8', '#7fa8cc'] },
  snow:     { life: 4.0, count: 300, size: 0.13, vel: [0.35, -1.0, 0.35], gravity: -0.25, spread: 0.95, grow: 0.08, turb: 0.6, additive: false, oneShot: false, colors: ['#ffffff', '#e8f2fb', '#c9d9ea'] },
  embers:   { life: 2.4, count: 220, size: 0.08, vel: [0.25, 1.5, 0.25], gravity: 0.35, spread: 0.7, grow: -0.2, turb: 0.85, additive: true, oneShot: false, colors: ['#ffd9a0', '#ff9a45', '#c2451a'] },
  magic:    { life: 2.6, count: 260, size: 0.11, vel: [0.3, 0.8, 0.3], gravity: 0.15, spread: 0.85, grow: -0.35, turb: 0.95, additive: true, oneShot: false, colors: ['#f5c2ff', '#b48cf5', '#7fe8ff'] },
  dust:     { life: 6.0, count: 200, size: 0.16, vel: [0.18, 0.12, 0.18], gravity: -0.04, spread: 1.0, grow: 0.35, turb: 0.3, additive: false, oneShot: false, colors: ['#b8ac97', '#94897a', '#6f675e'] },
  fireworks:{ life: 1.9, count: 380, size: 0.09, vel: [0.9, 4.6, 0.9], gravity: -2.6, spread: 1.0, grow: -0.25, turb: 0.08, additive: true, oneShot: false, colors: ['#fff6cf', '#ffc466', '#e05a8f'] },
  lightning: { life: 0.16, count: 90, size: 0.22, vel: [0.5, -16.0, 0.5], gravity: 0, spread: 0.12, grow: 0.3, turb: 0.02, additive: true, oneShot: true, colors: ['#ffffff', '#cfe8ff', '#7fb0ff'] },
  portal:   { life: 3.2, count: 300, size: 0.1, vel: [0.9, 0.2, 0.9], gravity: 0, spread: 1.0, grow: -0.15, turb: 1.2, additive: true, oneShot: false, colors: ['#d9b3ff', '#9d5cff', '#3fd0ff'] },
  hearts:   { life: 3.0, count: 200, size: 0.13, vel: [0.3, 1.1, 0.3], gravity: 0.2, spread: 0.8, grow: 0.05, turb: 0.5, additive: false, oneShot: false, colors: ['#ff9ecb', '#ff6fae', '#e84a8a'] },
  stars:    { life: 2.8, count: 260, size: 0.09, vel: [0.2, 0.35, 0.2], gravity: 0.05, spread: 1.0, grow: -0.2, turb: 0.7, additive: true, oneShot: false, colors: ['#fff8d6', '#ffe98a', '#ffd24a'] },
};

export function defaultFxProps(kind) {
  return { fxKind: FX_KINDS.includes(kind) ? kind : 'fire', intensity: 1, fxSize: 1, fxSpeed: 1, fxStart: 0 };
}

/* ---- pure helpers (mirrored in the shader; unit-tested for determinism) ---- */

// age in [0,1) of particle `seed` at time `t`. All kinds gate on fxStart;
// looping kinds wrap forever, one-shot kinds (explosion) burn out once.
// Mirrors the shader exactly: fract() is always in [0,1), so negative local
// time (before the start) is gated to -1 = invisible for every kind.
export function fxParticleAge(kind, seed, t, fxStart = 0, life = FX_PRESETS[kind].life) {
  const local = t - fxStart;
  if (local < 0) return -1; // not started yet — hidden for looping and one-shot alike
  if (FX_PRESETS[kind].oneShot) {
    return (local + seed * life * 0.35) / life; // >=0; >1 means burnt out
  }
  return ((local / life + seed) % 1 + 1) % 1; // GLSL fract(): always [0,1)
}

// deterministic per-particle seeds derived from the object id — rebuilding,
// reopening or exporting always produces the same particle field.
// (hash-based PRNG: no Math.random(), so rebuilds are stable)
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function fxSeedAt(id, i) {
  let h = hashString(id) ^ Math.imul(i + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) ^ 0xc2b2ae35;
  h = Math.imul(h ^ (h >>> 13), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// the aSeed attribute buffer for an effect object — stable across rebuilds
export function fxSeeds(o, count) {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = fxSeedAt(o.id, i * 4);
    out[i * 4 + 1] = fxSeedAt(o.id, i * 4 + 1);
    out[i * 4 + 2] = fxSeedAt(o.id, i * 4 + 2);
    out[i * 4 + 3] = fxSeedAt(o.id, i * 4 + 3);
  }
  return out;
}

// visibility multiplier for an age — 0 before trigger, ramped in/out.
export function fxAgeFade(kind, age) {
  if (age < 0) return 0;
  if (FX_PRESETS[kind].oneShot && age > 1) return 0;
  const a = Math.min(age, 1);
  return Math.min(a / 0.12, 1) * (1 - Math.max(0, (a - 0.55) / 0.45));
}
