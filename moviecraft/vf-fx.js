// Cinematic FX engine: GPU particle system. Every particle is a pure
// function of (seed, t) — no simulation state — so scrubbing, playback and
// frame-accurate export all produce identical frames.
import * as THREE from 'three';
import { FX_PRESETS, fxSeeds } from './vf-fx-core.js';
export { FX_KINDS, FX_LABELS, FX_PRESETS, defaultFxProps, fxParticleAge, fxAgeFade } from './vf-fx-core.js';



const FX_VERT = `
  uniform float uTime, uStart, uLife, uSize, uSpeed, uIntensity, uPixelRatio, uScale, uGravity, uGrow, uTurb, uSpread, uOneShot;
  uniform vec3 uVel;
  attribute vec4 aSeed;
  varying float vAge, vFade, vSeed;
  void main(){
    float local = uTime - uStart;
    float age;
    if (local < 0.0) {
      // before its start time the effect is hidden — looping and one-shot alike
      vFade = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return;
    }
    float T; // trajectory time: time since THIS particle was born
    if (uOneShot > 0.5) {
      age = (local + aSeed.x * uLife * 0.35) / uLife;
      T = local;
    } else {
      age = fract(local / uLife + aSeed.x); // wraps: emitter respawns forever
      T = age * uLife;
    }
    // seeded direction: ring angle + radial jitter, biased by the preset velocity
    float ang = aSeed.y * 6.28318530718;
    float radial = mix(1.0 - uSpread, 1.0, aSeed.z);
    float mag = (0.55 + 0.9 * aSeed.w) * uSpeed;
    vec3 vel = vec3(uVel.x * cos(ang) * radial, uVel.y, uVel.z * sin(ang) * radial) * mag;
    vec3 p = vel * T;
    p.y += 0.5 * uGravity * T * T;
    // deterministic turbulence: swirl grows with age, never depends on wall-clock
    float sw = aSeed.y * 6.28318530718;
    p.x += sin(sw + age * 9.0 + aSeed.z * 3.0) * uTurb * age;
    p.z += cos(sw * 1.3 + age * 7.0) * uTurb * age;
    vAge = clamp(age, 0.0, 1.0);
    vSeed = aSeed.x;
    if (uOneShot > 0.5 && age > 1.0) {
      vFade = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return;
    }
    vFade = min(vAge / 0.12, 1.0) * (1.0 - max(0.0, (vAge - 0.55) / 0.45));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float s = uSize * (1.0 + vAge * uGrow) * (0.7 + 0.6 * aSeed.z) * uScale;
    gl_PointSize = max(0.0, s * uPixelRatio * 240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;

const FX_FRAG = `
  uniform vec3 uColorA, uColorB, uColorC;
  uniform float uOpacity, uIntensity;
  varying float vAge, vFade, vSeed;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float alpha = (1.0 - smoothstep(0.04, 0.5, d)) * vFade;
    if (alpha < 0.004) discard;
    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.5, vAge));
    col = mix(col, uColorC, smoothstep(0.5, 1.0, vAge));
    // deterministic per-particle flicker
    col *= 0.82 + 0.36 * sin(vSeed * 43.7 + vAge * 19.0);
    gl_FragColor = vec4(col, alpha * uOpacity * uIntensity);
  }`;

export function buildFxPoints(o, renderer) {
  const p = FX_PRESETS[o.fxKind] || FX_PRESETS.fire;
  const count = Math.max(20, Math.round(p.count * (o.intensity ?? 1)));
  const geo = new THREE.BufferGeometry();
  // stable seeds derived from the object id — rebuilds/exports are identical
  const seeds = fxSeeds(o, count);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // dummy, real pos in shader
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: FX_VERT, fragmentShader: FX_FRAG,
    transparent: true, depthWrite: false,
    blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uStart: { value: o.fxStart ?? 0 }, uLife: { value: p.life },
      uSize: { value: p.size * (o.fxSize ?? 1) }, uSpeed: { value: o.fxSpeed ?? 1 },
      uIntensity: { value: o.intensity ?? 1 }, uOpacity: { value: o.opacity ?? 1 },
      uPixelRatio: { value: 1 }, uScale: { value: 1 },
      uGravity: { value: p.gravity }, uGrow: { value: p.grow }, uTurb: { value: p.turb }, uSpread: { value: p.spread },
      uOneShot: { value: p.oneShot ? 1 : 0 },
      uVel: { value: new THREE.Vector3(...p.vel) },
      uColorA: { value: new THREE.Color(p.colors[0]) },
      uColorB: { value: new THREE.Color(p.colors[1]) },
      uColorC: { value: new THREE.Color(p.colors[2]) },
    },
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // positions live in the shader
  points.renderOrder = 5;
  return {
    points,
    update(t, opacity, scaleAvg, pixelRatio) {
      const u = mat.uniforms;
      u.uTime.value = t;
      u.uOpacity.value = opacity ?? 1;
      u.uScale.value = scaleAvg ?? 1;
      u.uPixelRatio.value = pixelRatio ?? 1;
      // live prop edits (kind/params) rebuild the object; these are cheap keeps:
      u.uStart.value = o.fxStart ?? 0;
      u.uSpeed.value = o.fxSpeed ?? 1;
      u.uIntensity.value = o.intensity ?? 1;
      u.uSize.value = (FX_PRESETS[o.fxKind] || FX_PRESETS.fire).size * (o.fxSize ?? 1);
    },
  };
}
