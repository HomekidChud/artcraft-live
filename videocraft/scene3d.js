// scene3d.js — 3D scene clips: objects, characters, FX, camera moves, keyframes
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLookEngine } from './look.js?v=1.3.2';

let uid = 1;
export const newId = (p = 'id') => `${p}${(uid++).toString(36)}${Date.now().toString(36).slice(-4)}`;

// ---------------------------------------------------------------- scene defs

const CHAR_MOTIONS = ['none', 'idle', 'walk', 'run', 'wave', 'celebrate', 'jump', 'dance', 'point', 'nod', 'shakehead', 'punch', 'bow', 'sit'];
const FX_KINDS = ['fire', 'explosion', 'confetti', 'sparks', 'fountain', 'rain', 'snow', 'embers', 'magic', 'smoke', 'lightning', 'portal', 'hearts', 'stars'];
const LIGHT_PRESETS = ['three-point', 'sunset', 'night', 'dramatic', 'daylight', 'neon', 'candlelight', 'horror', 'sunrise', 'storm', 'forest'];

export function makeObject(type, over = {}) {
  const base = {
    id: newId('o'), type, name: type[0].toUpperCase() + type.slice(1),
    pos: [0, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    color: '#d9d2c7', opacity: 1, keys: [],
  };
  if (type === 'ground') { base.pos = [0, 0, 0]; base.scale = [30, 1, 30]; base.color = '#2c3140'; }
  if (type === 'text') { base.text = 'TITLE'; base.size = 1; base.color = '#ffffff'; }
  if (type === 'character') {
    base.name = 'Character'; base.motion = 'idle'; base.pos = [0, 0, 0]; base.scale = [1, 1, 1];
    base.skin = '#e8b88a'; base.shirt = '#c9553d'; base.pants = '#31465e'; base.hair = '#2a2018';
  }
  if (type === 'fx') { base.fx = 'fire'; base.size = 1; }
  if (type === 'sphere') { base.scale = [0.7, 0.7, 0.7]; }
  if (type === 'box') { base.scale = [1, 1, 1]; }
  return Object.assign(base, over);
}

export function makeScene(preset = 'hero') {
  const s = {
    id: newId('sc'), name: '3D Scene', duration: 6,
    sky: '#0d1522', fog: 0.0, lighting: 'three-point',
    camera: { pos: [7, 4, 11], target: [0, 1.4, 0] }, camKeys: [],
    look: { style: 'film', grade: 'cine', bloom: 0.55, vignette: 0.4, grain: 0.05, chroma: 0.5, outline: 1.0, toonSteps: 4, exposure: 1.0, streak: 0.25 },
    objects: [], events: [{ type: 'fadein', t: 0, dur: 0.6 }, { type: 'fadeout', t: 5.4, dur: 0.6 }],
    _rev: 1,
  };
  if (preset === 'hero') {
    s.objects.push(makeObject('ground'));
    s.objects.push(makeObject('character', { name: 'Hero', pos: [0, 0, 0] }));
    s.objects.push(makeObject('box', { name: 'Prop', pos: [2.2, 0.5, -1], color: '#b0a48f', scale: [1, 1, 1] }));
  } else if (preset === 'landscape') {
    s.objects.push(makeObject('ground', { color: '#2e3d2e', scale: [60, 1, 60] }));
    s.objects.push(makeObject('sphere', { name: 'Sun', pos: [-14, 9, -22], color: '#ffd9a0', scale: [3, 3, 3] }));
    s.objects.push(makeObject('cylinder', { name: 'Tower', pos: [6, 2, -8], color: '#5d6577', scale: [1.2, 4, 1.2] }));
    s.objects.push(makeObject('fx', { name: 'Mist', fx: 'fire', pos: [0, 0.4, 2], size: 2.4 }));
    s.look = { ...s.look, grade: 'sunset', bloom: 0.8, streak: 0.5 };
  } else if (preset === 'anime') {
    s.objects.push(makeObject('ground', { color: '#3a4a5e', scale: [40, 1, 40] }));
    s.objects.push(makeObject('character', { name: 'Protagonist', pos: [-1, 0, 0], hair: '#1d2f4d', shirt: '#e8e4dc', motion: 'wave' }));
    s.objects.push(makeObject('cylinder', { name: 'Lamp post', pos: [3, 1.8, -2], color: '#8a93a5', scale: [0.15, 3.6, 0.15] }));
    s.look = { ...s.look, style: 'anime', grade: 'comic', bloom: 0.35, outline: 1.0, streak: 0.0, vignette: 0.25 };
  } else if (preset === 'empty') {
    s.objects.push(makeObject('ground'));
  }
  return s;
}

// ---------------------------------------------------------------- keyframes

// Key easing: 'smooth' (default), 'linear', 'step', 'easein', 'easeout', 'back', 'bounce'
export function easeFactor(ease, f) {
  switch (ease) {
    case 'linear': return f;
    case 'step': return 0;
    case 'easein': return f * f;
    case 'easeout': return 1 - (1 - f) * (1 - f);
    case 'back': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(f - 1, 3) + c1 * Math.pow(f - 1, 2); }
    case 'bounce': {
      const n1 = 7.5625, d1 = 2.75;
      if (f < 1 / d1) return n1 * f * f;
      if (f < 2 / d1) return n1 * (f -= 1.5 / d1) * f + 0.75;
      if (f < 2.5 / d1) return n1 * (f -= 2.25 / d1) * f + 0.9375;
      return n1 * (f -= 2.625 / d1) * f + 0.984375;
    }
    default: return f * f * (3 - 2 * f); // 'smooth'
  }
}

function sampleKeys(keys, t, base) {
  if (!keys || !keys.length) return { pos: base.pos, rot: base.rot, scale: base.scale };
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return { pos: sorted[0].pos ?? base.pos, rot: sorted[0].rot ?? base.rot, scale: sorted[0].scale ?? base.scale };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t - a.t > 1e-6 ? (t - a.t) / (b.t - a.t) : 0;
      const e = easeFactor(a.ease ?? 'smooth', f);
      const mix = (av, bv) => av.map((v, j) => v + (bv[j] - v) * e);
      return {
        pos: mix(a.pos ?? base.pos, b.pos ?? base.pos),
        rot: mix(a.rot ?? base.rot, b.rot ?? base.rot),
        scale: mix(a.scale ?? base.scale, b.scale ?? base.scale),
      };
    }
  }
  const last = sorted[sorted.length - 1];
  return { pos: last.pos ?? base.pos, rot: last.rot ?? base.rot, scale: last.scale ?? base.scale };
}

export function sampleCamera(scene, t) {
  const base = { pos: scene.camera.pos, target: scene.camera.target };
  if (!scene.camKeys?.length) return base;
  const sorted = [...scene.camKeys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return { pos: sorted[0].pos, target: sorted[0].target };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t - a.t > 1e-6 ? (t - a.t) / (b.t - a.t) : 0;
      const e = easeFactor(a.ease ?? 'smooth', f);
      const mix = (av, bv) => av.map((v, j) => v + (bv[j] - v) * e);
      return { pos: mix(a.pos, b.pos), target: mix(a.target, b.target) };
    }
  }
  const last = sorted[sorted.length - 1];
  return { pos: last.pos, target: last.target };
}

// ---------------------------------------------------------------- character

function limb(len, rad, mat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len - rad * 2, 3, 8), mat);
  m.position.y = -len / 2;
  g.add(m);
  return g;
}

function buildCharacter(def) {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.75, metalness: 0.05 });
  const skin = mat(def.skin), shirt = mat(def.shirt), pants = mat(def.pants), hair = mat(def.hair);
  // user-authored proportions — every value is a live slider, nothing fixed
  const B = { height: 1, head: 1, arms: 1, legs: 1, torso: 1, ...(def.build || {}) };
  const root = new THREE.Group();
  root.name = def.id;

  const hips = new THREE.Group(); hips.position.y = 0.06 + 0.86 * B.legs; root.add(hips); // feet stay grounded at any leg length
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.12, 3, 8), pants); pelvis.position.y = 0.06; hips.add(pelvis);

  const torso = new THREE.Group(); torso.position.y = 0.14; hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.32, 4, 10), shirt); chest.position.y = 0.26; torso.add(chest);
  chest.scale.set(B.torso, 1, B.torso);

  const neck = new THREE.Group(); neck.position.y = 0.5 * B.height; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.1; neck.add(head);
  head.scale.setScalar(B.head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 14), skin); skull.position.y = 0.12; head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), hair); hairM.position.set(0, 0.17, -0.015); hairM.scale.set(1, 0.82, 1); head.add(hairM);

  const arms = {};
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.24 * B.torso, 0.42, 0); torso.add(shoulder);
    const upper = limb(0.32 * B.arms, 0.07, shirt); shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.32 * B.arms; upper.add(elbow);
    const lower = limb(0.3 * B.arms, 0.055, skin); elbow.add(lower);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), skin); hand.position.y = -0.32 * B.arms; elbow.add(hand);
    arms[side] = { shoulder, elbow };
  }
  const legs = {};
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.11, 0, 0); hips.add(hip);
    const upper = limb(0.44 * B.legs, 0.085, pants); hip.add(upper);
    const knee = new THREE.Group(); knee.position.y = -0.44 * B.legs; upper.add(knee);
    const lower = limb(0.42 * B.legs, 0.07, pants); knee.add(lower);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), mat('#20242c')); foot.position.set(0, -0.45 * B.legs, 0.05); knee.add(foot);
    legs[side] = { hip, knee };
  }
  root.userData.baseHipsY = hips.position.y;
  return { root, arms, legs, hips, torso, head };
}

// ---------------------------------------------------------------- pose keys
// Free-form motion: a list of {t, pose} captured interactively.
// pose params are degrees: shLx/shLz/elL (left arm), shRx/shRz/elR (right arm),
// hipL/kneeL/hipR/kneeR (legs), headX/headY, torsoX/torsoY.
export const POSE_PARAMS = {
  shLx: 8, shLz: 0, elL: -15, shRx: 8, shRz: 0, elR: -15,
  hipL: 0, kneeL: 4, hipR: 0, kneeR: 4,
  headX: 0, headY: 0, torsoX: 0, torsoY: 0,
};
export function samplePoseKeys(keys, t) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (!sorted.length) return { ...POSE_PARAMS };
  if (t <= sorted[0].t) return { ...POSE_PARAMS, ...sorted[0].pose };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / ((b.t - a.t) || 1);
      const e = f * f * (3 - 2 * f); // smoothstep
      const out = {};
      for (const p of Object.keys(POSE_PARAMS)) {
        const av = a.pose?.[p] ?? POSE_PARAMS[p], bv = b.pose?.[p] ?? POSE_PARAMS[p];
        out[p] = av + (bv - av) * e;
      }
      return out;
    }
  }
  return { ...POSE_PARAMS, ...sorted[sorted.length - 1].pose };
}

function poseCharacter(ch, def, t) {
  const A = ch.arms, L = ch.legs;
  const set = (e, x, z = 0) => { if (e) { e.x = x; e.z = z; } };
  // user-authored motion overrides the preset entirely
  if (def.poseKeys?.length) {
    const p = samplePoseKeys(def.poseKeys, t), D = Math.PI / 180;
    A[-1].shoulder.rotation.set(p.shLx * D, 0, p.shLz * D);
    A[1].shoulder.rotation.set(p.shRx * D, 0, p.shRz * D);
    A[-1].elbow.rotation.x = p.elL * D; A[1].elbow.rotation.x = p.elR * D;
    L[-1].hip.rotation.x = p.hipL * D; L[1].hip.rotation.x = p.hipR * D;
    L[-1].knee.rotation.x = p.kneeL * D; L[1].knee.rotation.x = p.kneeR * D;
    ch.head.rotation.set(p.headX * D, p.headY * D, 0);
    ch.torso.rotation.set(p.torsoX * D, p.torsoY * D, 0);
    return;
  }
  const motion = def.motion || 'idle';
  const baseY = ch.root.userData.baseHipsY ?? 0.92;
  switch (motion) {
    case 'idle': {
      const b = Math.sin(t * 1.6) * 0.02;
      ch.hips.position.y = baseY + b * 0.5;
      set(ch.torso.rotation, 0); ch.torso.rotation.y = Math.sin(t * 0.6) * 0.06;
      set(A[-1].shoulder.rotation, 0.08 + b); set(A[1].shoulder.rotation, 0.08 - b);
      set(A[-1].elbow.rotation, -0.15); set(A[1].elbow.rotation, -0.15);
      set(L[-1].hip.rotation, 0); set(L[1].hip.rotation, 0);
      set(L[-1].knee.rotation, 0.04); set(L[1].knee.rotation, 0.04);
      break;
    }
    case 'walk': {
      const s = Math.sin(t * 3.4), c = Math.cos(t * 3.4);
      set(L[-1].hip.rotation, s * 0.55); set(L[1].hip.rotation, -s * 0.55);
      set(L[-1].knee.rotation, Math.max(0, -s) * 0.7 + 0.08); set(L[1].knee.rotation, Math.max(0, s) * 0.7 + 0.08);
      set(A[-1].shoulder.rotation, -s * 0.4); set(A[1].shoulder.rotation, s * 0.4);
      set(A[-1].elbow.rotation, -0.25); set(A[1].elbow.rotation, -0.25);
      ch.hips.position.y = baseY + Math.abs(c) * 0.03;
      ch.torso.rotation.y = s * 0.08;
      break;
    }
    case 'run': {
      const s = Math.sin(t * 7), c = Math.cos(t * 7);
      set(L[-1].hip.rotation, -0.2 + s * 0.95); set(L[1].hip.rotation, -0.2 - s * 0.95);
      set(L[-1].knee.rotation, Math.max(0, -s) * 1.25 + 0.15); set(L[1].knee.rotation, Math.max(0, s) * 1.25 + 0.15);
      set(A[-1].shoulder.rotation, s * 0.85); set(A[1].shoulder.rotation, -s * 0.85);
      set(A[-1].elbow.rotation, -1.1); set(A[1].elbow.rotation, -1.1);
      ch.hips.position.y = baseY + Math.abs(c) * 0.06; ch.torso.rotation.x = 0.22;
      break;
    }
    case 'wave': {
      const w = Math.sin(t * 5.5);
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      A[1].shoulder.rotation.set(0, 0, -2.35); A[1].elbow.rotation.x = -0.35 + w * 0.45;
      set(A[-1].shoulder.rotation, 0.1); set(A[-1].elbow.rotation, -0.2);
      set(L[-1].hip.rotation, 0); set(L[1].hip.rotation, 0);
      break;
    }
    case 'celebrate': {
      const p = Math.abs(Math.sin(t * 4.4));
      ch.hips.position.y = baseY + p * 0.22;
      for (const s of [-1, 1]) {
        A[s].shoulder.rotation.set(0, 0, s * -2.6);
        A[s].elbow.rotation.x = -0.4 + Math.sin(t * 6 + s) * 0.3;
        set(L[s].hip.rotation, 0); set(L[s].knee.rotation, 0.06);
      }
      ch.torso.rotation.y = Math.sin(t * 1.2) * 0.1;
      break;
    }
    case 'jump': {
      const T = (t % 0.9), air = Math.sin(Math.min(T / 0.7, 1) * Math.PI);
      const crouch = T < 0.12 ? T / 0.12 : (T > 0.62 && T < 0.74) ? (0.74 - T) / 0.12 : 0;
      ch.hips.position.y = baseY + air * 0.85 - crouch * 0.2;
      set(ch.torso.rotation, 0);
      for (const s of [-1, 1]) {
        set(A[s].shoulder.rotation, -0.3 - air * 0.9); set(A[s].elbow.rotation, -0.35);
        set(L[s].hip.rotation, crouch * 0.7 + air * 0.4);
        set(L[s].knee.rotation, crouch * 1.2 + 0.06);
      }
      break;
    }
    case 'dance': {
      const b = Math.sin(t * 5.2), w = Math.sin(t * 2.6);
      ch.hips.position.y = baseY + Math.abs(b) * 0.15;
      ch.hips.position.x = w * 0.1;
      ch.torso.rotation.y = -w * 0.25; set(ch.torso.rotation, b * 0.1);
      for (const s of [-1, 1]) {
        A[s].shoulder.rotation.set(0, 0, s * (-1.5 + b * 0.7));
        set(A[s].elbow.rotation, -1.1 + b * 0.4 * s);
        set(L[s].hip.rotation, -w * 0.25 * s);
        set(L[s].knee.rotation, Math.abs(b) * 0.35 + 0.06);
      }
      break;
    }
    case 'point': {
      const raise = Math.min(1, t / 0.25);
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      ch.torso.rotation.y = 0.18 * raise;
      A[1].shoulder.rotation.set(-1.35 * raise, 0, 0.35 * raise);
      A[1].elbow.rotation.x = -0.15 * raise;
      set(A[-1].shoulder.rotation, 0.1); set(A[-1].elbow.rotation, -0.2);
      set(L[-1].hip.rotation, 0); set(L[1].hip.rotation, 0);
      break;
    }
    case 'nod': {
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      ch.head.rotation.x = Math.sin(t * 4.4) * 0.22;
      break;
    }
    case 'shakehead': {
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      ch.head.rotation.y = Math.sin(t * 5.6) * 0.35;
      break;
    }
    case 'punch': {
      const P = t % 1.1;
      const jab = P < 0.18 ? P / 0.18 : P < 0.4 ? 1 - (P - 0.18) / 0.22 : 0;
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      ch.torso.rotation.y = -jab * 0.5;
      A[1].shoulder.rotation.set(-0.4 - jab * 0.3, 0, 0.7 - jab * 0.6);
      A[1].elbow.rotation.x = -1.5 + jab * 1.35;
      A[-1].shoulder.rotation.set(-0.18, 0, -0.22); A[-1].elbow.rotation.x = -1.2;
      set(L[-1].hip.rotation, 0); set(L[1].hip.rotation, 0);
      break;
    }
    case 'bow': {
      let p;
      if (t < 0.45) p = t / 0.45; else if (t < 1.35) p = 1; else if (t < 1.8) p = 1 - (t - 1.35) / 0.45; else p = 0;
      ch.hips.position.y = baseY - p * 0.06;
      set(ch.torso.rotation, 0.75 * p);
      ch.head.rotation.x = 0.35 * p;
      for (const s of [-1, 1]) { set(A[s].shoulder.rotation, 0.5 * p); set(A[s].elbow.rotation, -0.1); set(L[s].hip.rotation, 0); }
      break;
    }
    case 'sit': {
      ch.hips.position.y = baseY - 0.55;
      set(ch.torso.rotation, 0.06);
      for (const s of [-1, 1]) {
        set(A[s].shoulder.rotation, -0.25); set(A[s].elbow.rotation, -0.9);
        set(L[s].hip.rotation, 1.45); set(L[s].knee.rotation, -1.35);
      }
      break;
    }
    default: {
      ch.hips.position.y = baseY; set(ch.torso.rotation, 0);
      for (const s of [-1, 1]) { set(A[s].shoulder.rotation, 0); set(A[s].elbow.rotation, 0); set(L[s].hip.rotation, 0); set(L[s].knee.rotation, 0); }
    }
  }
}

// ---------------------------------------------------------------- FX

const FX_N = 170;
function buildFX(def) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(FX_N * 3), col = new Float32Array(FX_N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.userData.noToon = true;
  return pts;
}

const FX_COLORS = {
  fire: [[1, 0.55, 0.1], [1, 0.8, 0.3], [0.9, 0.25, 0.05]],
  explosion: [[1, 0.6, 0.15], [1, 0.85, 0.4], [0.5, 0.5, 0.55]],
  confetti: [[1, 0.4, 0.5], [0.4, 0.8, 1], [1, 0.9, 0.3], [0.6, 1, 0.6]],
  sparks: [[1, 0.9, 0.6], [1, 0.75, 0.4]],
  fountain: [[0.5, 0.8, 1], [0.7, 0.9, 1], [1, 1, 1]],
  rain: [[0.75, 0.85, 0.95], [0.6, 0.72, 0.88]],
  snow: [[1, 1, 1], [0.9, 0.95, 1]],
  embers: [[1, 0.8, 0.45], [1, 0.55, 0.2], [0.85, 0.3, 0.1]],
  magic: [[0.96, 0.8, 1], [0.7, 0.6, 1], [0.5, 0.9, 1]],
  smoke: [[0.45, 0.45, 0.5], [0.3, 0.3, 0.35], [0.2, 0.2, 0.25]],
  lightning: [[1, 1, 1], [0.8, 0.9, 1], [0.5, 0.7, 1]],
  portal: [[0.85, 0.7, 1], [0.62, 0.36, 1], [0.25, 0.8, 1]],
  hearts: [[1, 0.62, 0.8], [1, 0.44, 0.68], [0.91, 0.29, 0.54]],
  stars: [[1, 0.97, 0.84], [1, 0.91, 0.54], [1, 0.82, 0.29]],
};

function updateFX(def, pts, t) {
  const pos = pts.geometry.attributes.position.array;
  const col = pts.geometry.attributes.color.array;
  const S = def.size || 1, kind = def.fx;
  const cols = FX_COLORS[kind] || FX_COLORS.fire;
  for (let i = 0; i < FX_N; i++) {
    const seed = (i * 137.13) % 1;
    const c = cols[i % cols.length];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    let x, y, z, life;
    if (kind === 'fire') {
      const a = seed * Math.PI * 2, life = ((t * (0.7 + seed * 0.5)) + seed) % 1;
      const r = (1 - life) * 0.45 * S;
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = life * 1.9 * S;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    } else if (kind === 'explosion') {
      const period = 2.6, bt = (t % period), a = seed * Math.PI * 2, ph = seed * Math.PI - Math.PI / 2;
      const life = Math.min(1, bt / 1.6);
      const r = life * 2.6 * S * (0.6 + seed * 0.7);
      x = Math.cos(a) * Math.cos(ph) * r; y = Math.abs(Math.sin(ph)) * r * 0.9 + life * 0.4; z = Math.sin(a) * Math.cos(ph) * r;
      if (bt > 1.7) { pos[i * 3 + 1] = -999; continue; }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    } else if (kind === 'confetti') {
      const a = seed * Math.PI * 2, drift = Math.sin(t * 1.4 + seed * 8) * 0.5;
      const yy = ((t * (0.55 + seed * 0.3) + seed * 3) % 3.4);
      pos[i * 3] = Math.cos(a) * (0.4 + seed) * S + drift; pos[i * 3 + 1] = 3.2 * S - yy * S; pos[i * 3 + 2] = Math.sin(a) * (0.4 + seed) * S;
    } else if (kind === 'sparks') {
      const a = seed * Math.PI * 2, v = 1.4 + seed * 1.6, tt = (t + seed * 2) % 1.1;
      pos[i * 3] = Math.cos(a) * v * tt * S; pos[i * 3 + 1] = 1.2 * S + v * 0.7 * tt - tt * tt * 2.2; pos[i * 3 + 2] = Math.sin(a) * v * tt * S;
    } else if (kind === 'rain') {
      // fast falling streaks across a wide column, wrapping forever
      const fall = ((t * (2.4 + seed * 0.8) + seed * 5) % 3.8) * S;
      const a = seed * Math.PI * 2;
      const r = (0.35 + seed * 0.65) * 2.2 * S;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 3.6 * S - fall; pos[i * 3 + 2] = Math.sin(a) * r;
    } else if (kind === 'snow') {
      // slow drifting flakes with sinusoidal sway
      const fall = ((t * (0.35 + seed * 0.25) + seed * 4) % 4.2) * S;
      const sway = Math.sin(t * (0.8 + seed) + seed * 9) * 0.5;
      pos[i * 3] = (seed - 0.5) * 3.6 * S + sway; pos[i * 3 + 1] = 3.8 * S - fall; pos[i * 3 + 2] = (Math.cos(seed * 7.3) * 1.6) * S;
    } else if (kind === 'embers') {
      // rising glowing motes with a wobble
      const life = ((t * (0.45 + seed * 0.3) + seed * 3) % 2.6);
      const wobble = Math.sin(life * 3 + seed * 12) * 0.25;
      const a = seed * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * (0.15 + seed * 0.5) * S + wobble; pos[i * 3 + 1] = 0.2 + life * 1.1 * S; pos[i * 3 + 2] = Math.sin(a) * (0.15 + seed * 0.5) * S;
    } else if (kind === 'magic') {
      // slow twinkling rise, shrinking with age
      const life = ((t * (0.3 + seed * 0.25) + seed * 6) % 3);
      const twinkle = 0.5 + 0.5 * Math.sin(t * 5 + seed * 20);
      const a = seed * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * (0.2 + seed * 0.8) * S; pos[i * 3 + 1] = 0.2 + life * 0.9 * S; pos[i * 3 + 2] = Math.sin(a) * (0.2 + seed * 0.8) * S;
      col[i * 3] *= 0.6 + twinkle * 0.7; col[i * 3 + 1] *= 0.6 + twinkle * 0.7; col[i * 3 + 2] *= 0.6 + twinkle * 0.7;
    } else if (kind === 'smoke') {
      // slow expanding plume
      const life = ((t * (0.3 + seed * 0.2) + seed * 4) % 3.4);
      const a = seed * Math.PI * 2;
      const r = (0.15 + life * 0.45 + seed * 0.2) * S;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.2 + life * 2.2 * S; pos[i * 3 + 2] = Math.sin(a) * r;
    } else if (kind === 'lightning') {
      // jagged downward strike, visible in short deterministic bursts
      const cycle = (t * 1.7 + seed * 5) % 3;
      const on = cycle < 0.18 ? 1 : cycle < 0.5 ? 0.15 : 0;
      const fall = ((t * 14 + seed * 4) % 3.4) * S;
      const jx = Math.sin(seed * 40 + Math.floor(t * 20)) * 0.35;
      pos[i * 3] = jx; pos[i * 3 + 1] = 3.4 * S - fall; pos[i * 3 + 2] = Math.cos(seed * 9.1) * 0.4;
      col[i * 3] *= on; col[i * 3 + 1] *= on; col[i * 3 + 2] *= on;
    } else if (kind === 'portal') {
      // particles swirling around a vertical ring
      const ang = seed * Math.PI * 2 + t * (1.2 + seed * 0.8) * (seed > 0.5 ? 1 : -1);
      const r = (0.8 + Math.sin(t * 1.5 + seed * 7) * 0.18) * S;
      pos[i * 3] = Math.cos(ang) * r; pos[i * 3 + 1] = (seed - 0.5) * 2.4 * S + Math.sin(t + seed * 5) * 0.1; pos[i * 3 + 2] = Math.sin(ang) * r;
    } else if (kind === 'hearts') {
      // slow rising hearts with a gentle sway
      const life = ((t * (0.35 + seed * 0.2) + seed * 5) % 3);
      pos[i * 3] = (seed - 0.5) * 2.2 * S + Math.sin(life * 2 + seed * 9) * 0.3; pos[i * 3 + 1] = 0.2 + life * 1.0 * S; pos[i * 3 + 2] = (Math.cos(seed * 5.3) * 1.2) * S;
    } else if (kind === 'stars') {
      // twinkling golden field, drifting slowly upward
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * (2 + seed * 3) + seed * 20));
      const life = ((t * (0.15 + seed * 0.15) + seed * 7) % 3.2);
      const a = seed * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * (0.2 + seed * 1.8) * S; pos[i * 3 + 1] = 0.3 + life * 0.8 * S; pos[i * 3 + 2] = Math.sin(a) * (0.2 + seed * 1.8) * S;
      col[i * 3] *= twinkle; col[i * 3 + 1] *= twinkle; col[i * 3 + 2] *= twinkle;
    } else { // fountain
      const a = seed * Math.PI * 2, tt = (t * 0.9 + seed * 2.3) % 1.9;
      const v = (1.5 + seed) * S;
      pos[i * 3] = Math.cos(a) * 0.25 * S + Math.cos(a) * 0.35 * tt * S; pos[i * 3 + 1] = 0.5 + v * tt - 2.6 * tt * tt; pos[i * 3 + 2] = Math.sin(a) * 0.25 * S + Math.sin(a) * 0.35 * tt * S;
      if (pos[i * 3 + 1] < -999) pos[i * 3 + 1] = -999;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
  pts.geometry.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- runtime

const runtimes = new Map();

function textTexture(text, color) {
  const c = document.createElement('canvas');
  const fs = 120;
  const ctx0 = c.getContext('2d');
  ctx0.font = `900 ${fs}px Satoshi, Inter, sans-serif`;
  const w = Math.ceil(ctx0.measureText(text).width) + 60;
  c.width = Math.max(64, w); c.height = fs * 1.4;
  const ctx = c.getContext('2d');
  ctx.font = `900 ${fs}px Satoshi, Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2);
  return new THREE.CanvasTexture(c);
}

function applyLighting(scene3, preset) {
  for (const c of [...scene3.children]) if (c.isLight || c.isAmbientLight) scene3.remove(c);
  const add = (l) => { scene3.add(l); return l; };
  add(new THREE.AmbientLight('#ffffff', preset === 'night' ? 0.16 : 0.32));
  if (preset === 'three-point') {
    const key = add(new THREE.DirectionalLight('#fff2df', 2.6)); key.position.set(5, 8, 6);
    const fill = add(new THREE.DirectionalLight('#bcd2ff', 0.8)); fill.position.set(-6, 4, 2);
    const rim = add(new THREE.DirectionalLight('#e8f0ff', 1.6)); rim.position.set(-2, 5, -8);
  } else if (preset === 'sunset') {
    add(new THREE.AmbientLight('#3d2f3f', 0.5));
    const sun = add(new THREE.DirectionalLight('#ffb066', 3.2)); sun.position.set(-14, 7, -10);
    const rim = add(new THREE.DirectionalLight('#5f7fbf', 1.1)); rim.position.set(8, 5, 8);
  } else if (preset === 'night') {
    const moon = add(new THREE.DirectionalLight('#8fb0ff', 1.5)); moon.position.set(-6, 10, -4);
    add(new THREE.PointLight('#4d6aa8', 12, 24)).position.set(3, 2, 3);
  } else { // dramatic
    add(new THREE.AmbientLight('#ffffff', 0.12));
    const spot = add(new THREE.SpotLight('#ffffff', 90, 30, 0.45, 0.4)); spot.position.set(0, 12, 2);
    const rim = add(new THREE.DirectionalLight('#ffd9a0', 1.2)); rim.position.set(0, 4, -10);
  }
  if (preset === 'daylight') {
    add(new THREE.AmbientLight('#ffffff', 0.5));
    const sun = add(new THREE.DirectionalLight('#fff6e0', 3.4)); sun.position.set(12, 16, 8);
    const sky = add(new THREE.HemisphereLight('#bcd8ff', '#8a7a5f', 0.9));
    const fill = add(new THREE.DirectionalLight('#dce8ff', 0.7)); fill.position.set(-10, 6, -6);
  } else if (preset === 'neon') {
    add(new THREE.AmbientLight('#2a2438', 0.9));
    const cyan = add(new THREE.PointLight('#22e0ff', 30, 22)); cyan.position.set(-5, 3.5, 3);
    const magenta = add(new THREE.PointLight('#ff2fd0', 30, 22)); magenta.position.set(5, 3, -3);
    const rim = add(new THREE.DirectionalLight('#7f9fff', 1.4)); rim.position.set(0, 6, -10);
  } else if (preset === 'candlelight') {
    add(new THREE.AmbientLight('#3a2a18', 1.2));
    const flame = add(new THREE.PointLight('#ffb45e', 18, 16, 2)); flame.position.set(0.4, 1.1, 0.8);
    const bounce = add(new THREE.PointLight('#ff8a3c', 7, 14, 2)); bounce.position.set(-1.2, 0.5, 1.4);
    const rim = add(new THREE.DirectionalLight('#c9a27a', 0.5)); rim.position.set(0, 4, -8);
  } else if (preset === 'horror') {
    add(new THREE.AmbientLight('#1a0f10', 0.8));
    const spot = add(new THREE.SpotLight('#e8f4ff', 45, 26, 0.35, 0.55)); spot.position.set(0, 1.2, 6); // under-lit faces
    const blood = add(new THREE.PointLight('#ff3020', 9, 18)); blood.position.set(-4, 2.5, -5);
    const rim = add(new THREE.DirectionalLight('#4f8f6f', 0.7)); rim.position.set(0, 5, -10);
  } else if (preset === 'sunrise') {
    add(new THREE.AmbientLight('#2a2436', 1.4));
    const sun = add(new THREE.DirectionalLight('#ff9d5c', 2.2)); sun.position.set(-14, 3.5, 6); // low, warm sun
    const fill = add(new THREE.HemisphereLight('#7f9fd9', '#2b2018', 0.8));
    const rim = add(new THREE.DirectionalLight('#ffd9a8', 1.0)); rim.position.set(8, 5, -8);
  } else if (preset === 'storm') {
    add(new THREE.AmbientLight('#39434e', 1.1));
    const key = add(new THREE.DirectionalLight('#aab8c8', 1.6)); key.position.set(-6, 14, 4); // cold, overhead
    const rim = add(new THREE.DirectionalLight('#5f708f', 2.0)); rim.position.set(0, 6, -10);
    const flash = add(new THREE.PointLight('#dfe9ff', 6, 20)); flash.position.set(4, 10, -6);
  } else if (preset === 'forest') {
    add(new THREE.AmbientLight('#26301f', 1.3));
    const sun = add(new THREE.DirectionalLight('#d8ffb0', 2.6)); sun.position.set(6, 12, 3); // dappled green key
    const bounce = add(new THREE.HemisphereLight('#a8d98f', '#2a2013', 0.9));
    const rim = add(new THREE.DirectionalLight('#e8ffd0', 0.8)); rim.position.set(0, 4, -9);
  }
}

function buildRuntime(scene) {
  const s3 = new THREE.Scene();
  s3.background = new THREE.Color(scene.sky || '#0d1522');
  if (scene.fog > 0.001) s3.fog = new THREE.FogExp2(scene.sky || '#0d1522', scene.fog * 0.045);
  applyLighting(s3, scene.lighting || 'three-point');

  const map = {}; // def.id -> { node, def, char?, fxPts? }
  for (const def of scene.objects) {
    let node = null;
    if (def.type === 'ground') {
      node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: 0.95 }));
      node.scale.set(def.scale[0], 0.24, def.scale[2]); node.position.set(def.pos[0], -0.12, def.pos[2]);
      node.userData.isGround = true;
    } else if (def.type === 'box') {
      node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: 0.6, metalness: 0.15, transparent: def.opacity < 1, opacity: def.opacity }));
    } else if (def.type === 'sphere') {
      node = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: 0.5, metalness: 0.1, transparent: def.opacity < 1, opacity: def.opacity, emissive: new THREE.Color(def.color), emissiveIntensity: def.type === 'sphere' ? 0.12 : 0 }));
    } else if (def.type === 'cylinder') {
      node = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 20), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: 0.7, transparent: def.opacity < 1, opacity: def.opacity }));
    } else if (def.type === 'text') {
      const tex = textTexture(def.text || 'TEXT', def.color || '#ffffff');
      const aspect = tex.image.width / tex.image.height;
      const h = (def.size || 1) * 0.5;
      node = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      node.userData.noToon = true;
    } else if (def.type === 'character') {
      const ch = buildCharacter(def);
      node = ch.root; map[def.id] = { node, def, char: ch };
      s3.add(node);
      continue;
    } else if (def.type === 'fx') {
      const pts = buildFX(def);
      node = pts; map[def.id] = { node, def, fxPts: pts };
      s3.add(node);
      continue;
    }
    if (node) { map[def.id] = { node, def }; s3.add(node); }
  }
  for (const [id, rec] of Object.entries(map)) rec.node.name = id;
  return { scene3: s3, map, rev: scene._rev };
}

function getRuntime(scene) {
  let rt = runtimes.get(scene.id);
  if (!rt || rt.rev !== scene._rev) {
    if (rt) disposeRuntime(rt);
    rt = buildRuntime(scene);
    runtimes.set(scene.id, rt);
  }
  return rt;
}

function disposeRuntime(rt) {
  rt.scene3.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }
  });
}

// ---------------------------------------------------------------- engine

const lookCanvas = document.createElement('canvas');
const lookEngine = createLookEngine(lookCanvas);

export const editorCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
export let controls = null;

export function attachControls(domElement) {
  controls = new OrbitControls(editorCamera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.set(0, 1.4, 0);
  return controls;
}

export function renderScene(scene, t, w, h, opts = {}) {
  const rt = getRuntime(scene);
  const tt = Math.max(0, Math.min(scene.duration, t));
  // objects
  for (const def of scene.objects) {
    const rec = rt.map[def.id];
    if (!rec) continue;
    const v = sampleKeys(def.keys, tt, def);
    if (def.type === 'ground') {
      rec.node.position.set(def.pos[0] + (v.pos[0] - def.pos[0]), -0.12, def.pos[2] + (v.pos[2] - def.pos[2]));
      rec.node.scale.set(v.scale[0], 0.24, v.scale[2]);
      rec.node.rotation.y = v.rot[1];
    } else if (def.type === 'character') {
      rec.node.position.set(v.pos[0], v.pos[1], v.pos[2]);
      rec.node.rotation.set(0, v.rot[1], 0);
      const sc = (v.scale[0] + v.scale[1] + v.scale[2]) / 3;
      rec.node.scale.setScalar(sc);
      poseCharacter(rec.char, def, tt);
    } else if (def.type === 'fx') {
      rec.node.position.set(v.pos[0], v.pos[1], v.pos[2]);
      rec.node.scale.setScalar((v.scale[0] + v.scale[1] + v.scale[2]) / 3 || 1);
      updateFX(def, rec.fxPts, tt);
    } else {
      rec.node.position.set(v.pos[0], v.pos[1], v.pos[2]);
      rec.node.rotation.set(v.rot[0], v.rot[1], v.rot[2]);
      rec.node.scale.set(v.scale[0], v.scale[1], v.scale[2]);
    }
  }
  // camera
  let cam;
  if (opts.editorCamera) {
    cam = editorCamera;
    cam.aspect = w / h; cam.updateProjectionMatrix();
    if (controls) controls.update();
  } else {
    cam = new THREE.PerspectiveCamera(50, w / h, 0.1, 400);
    const v = sampleCamera(scene, tt);
    cam.position.set(...v.pos);
    cam.lookAt(...v.target);
  }
  // look
  Object.assign(lookEngine.look, scene.look);
  lookEngine.setSize(w, h);
  return lookEngine.render(rt.scene3, cam, tt);
}

export function pickObject(scene, ndcX, ndcY) {
  const rt = getRuntime(scene);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), editorCamera);
  const hits = ray.intersectObjects(rt.scene3.children, true);
  for (const hit of hits) {
    let n = hit.object;
    while (n) {
      const def = scene.objects.find((d) => d.id === n.name);
      if (def) return def.id;
      n = n.parent;
    }
  }
  return null;
}

export { CHAR_MOTIONS, FX_KINDS, LIGHT_PRESETS };
