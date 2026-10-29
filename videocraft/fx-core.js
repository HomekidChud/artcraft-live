// Cinematic FX core: kind presets + deterministic age math shared by the
// shader, the props panel and the tests. Pure data & functions — no THREE.
// Every particle is a pure function of (seed, t) — no simulation state —
// so scrubbing backwards, playing and frame-accurate export all produce
// identical frames. Effects are scene objects: they transform, keyframe,
// save and export like any other object.
export const FX_KINDS = ['fire', 'smoke', 'sparks', 'explosion', 'fountain'];
export const FX_LABELS = { fire: 'Fire', smoke: 'Smoke', sparks: 'Sparks', explosion: 'Explosion', fountain: 'Fountain' };

// Per-kind look: velocity, physics and colour ramp shared by the shader.
export const FX_PRESETS = {
  fire:     { life: 1.1, count: 260, size: 0.55, vel: [0.32, 2.3, 0.32], gravity: 0.6, spread: 0.35, grow: 1.6, turb: 0.35, additive: true, oneShot: false, colors: ['#ffdca8', '#ff9a3c', '#c93010'] },
  smoke:    { life: 3.4, count: 170, size: 1.15, vel: [0.55, 0.85, 0.55], gravity: 0.12, spread: 0.8, grow: 2.4, turb: 0.5, additive: false, oneShot: false, colors: ['#565460', '#3c3a44', '#26252c'] },
  sparks:   { life: 0.9, count: 150, size: 0.09, vel: [1.6, 3.4, 1.6], gravity: -7.5, spread: 1.0, grow: 0.2, turb: 0.08, additive: true, oneShot: false, colors: ['#fff3c4', '#ffca6e', '#ff5f1e'] },
  explosion:{ life: 1.5, count: 460, size: 0.75, vel: [3.4, 2.6, 3.4], gravity: -3.2, spread: 1.0, grow: 1.1, turb: 0.22, additive: true, oneShot: true, colors: ['#fff6d8', '#ffb24a', '#b3300c'] },
  fountain: { life: 1.7, count: 320, size: 0.14, vel: [0.7, 5.2, 0.7], gravity: -9.0, spread: 0.22, grow: 0.1, turb: 0.05, additive: true, oneShot: false, colors: ['#eafffb', '#7fe3d4', '#2fa8c9'] },
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
