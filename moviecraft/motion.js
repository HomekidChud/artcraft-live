// Deterministic, per-instance animation. No renderer or mutable asset state.
export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForeArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];
export const MOTIONS = ['none', 'idle', 'walk', 'run', 'wave', 'celebrate', 'jump', 'dance', 'point', 'nod', 'shakehead', 'punch', 'bow', 'sit'];
const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;

// ---------------------------------------------------------------- custom clips
// User-authored motion: a clip is a sequence of poses captured interactively.
// { duration, loop, keys: [{ t, ease, pose: { jointId: [x, y, z] (deg) } }] }
// Any joint can be posed any way at any time — nothing here is hard-coded.
const CLIP_EASE = {
  linear: f => f,
  ease: f => f * f * (3 - 2 * f),
  easein: f => f * f,
  easeout: f => 1 - (1 - f) * (1 - f),
  back: f => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(f - 1, 3) + c1 * Math.pow(f - 1, 2); },
  bounce: f => {
    const n1 = 7.5625, d1 = 2.75;
    if (f < 1 / d1) return n1 * f * f;
    if (f < 2 / d1) return n1 * (f -= 1.5 / d1) * f + 0.75;
    if (f < 2.5 / d1) return n1 * (f -= 2.25 / d1) * f + 0.9375;
    return n1 * (f -= 2.625 / d1) * f + 0.984375;
  },
  step: () => 0,
};
export function normalizeCustomClip(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = (Array.isArray(input.keys) ? input.keys : [])
    .map(k => k && typeof k === 'object' ? {
      t: Math.max(0, finite(k.t, 0)), ease: CLIP_EASE[k.ease] ? k.ease : 'ease',
      pose: Object.fromEntries(Object.entries(k.pose || {}).map(([j, r]) => [j, Array.isArray(r) ? r.slice(0, 3).map(v => finite(v, 0)) : [0, 0, 0]])),
    } : null).filter(Boolean).filter(k => Object.keys(k.pose).length)
    .sort((a, b) => a.t - b.t);
  if (!keys.length) return null;
  const lastT = keys[keys.length - 1].t;
  const duration = Math.max(0.1, finite(input.duration, Math.max(lastT, 1)));
  return { duration, loop: input.loop !== false, keys };
}
export function evalCustomClip(clip, time) {
  const pose = {};
  JOINTS.forEach(j => { pose[j] = [0, 0, 0]; });
  const c = normalizeCustomClip(clip);
  if (!c) return pose;
  let t = Math.max(0, time);
  if (c.loop) t = t % c.duration; else t = Math.min(t, c.duration);
  const keys = c.keys;
  if (t <= keys[0].t) { applyPose(pose, keys[0].pose); return pose; }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t - a.t > 1e-6 ? (t - a.t) / (b.t - a.t) : 1;
      const e = (CLIP_EASE[a.ease] || CLIP_EASE.ease)(f);
      const joints = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
      for (const j of joints) {
        const av = a.pose[j] || [0, 0, 0], bv = b.pose[j] || [0, 0, 0];
        pose[j] = [0, 1, 2].map(k => (av[k] ?? 0) + ((bv[k] ?? 0) - (av[k] ?? 0)) * e);
      }
      return pose;
    }
  }
  applyPose(pose, keys[keys.length - 1].pose);
  return pose;
}
const applyPose = (pose, src) => { for (const [j, r] of Object.entries(src)) if (pose[j]) pose[j] = [...r]; };

export function motionPose(motion = {}, time = 0, duration = Infinity) {
  const pose = {};
  JOINTS.forEach(j => { pose[j] = [0, 0, 0]; });
  const start = Math.max(0, finite(motion.start, 0));
  const end = Math.max(start, finite(motion.end, duration));
  const speed = Math.max(0.05, finite(motion.speed, 1));
  const strength = Math.max(0, Math.min(2, finite(motion.strength, 1)));
  const t = Math.max(0, time - start);
  const phase = (t * speed + finite(motion.phase, 0)) * Math.PI * 2;
  const s = Math.sin(phase), c = Math.cos(phase);
  const clip = time < start || time > end ? 'none' : motion.clip;
  let lift = 0;
  // user-authored clip: 'custom:<name>' — fully open-ended motion
  if (typeof clip === 'string' && clip.startsWith('custom:') && motion.custom) {
    const customPose = evalCustomClip(motion.custom, (time - start) * speed);
    JOINTS.forEach(j => { pose[j] = customPose[j].map(v => v * strength); });
    return { pose, lift: lift * strength };
  }
  if (clip === 'idle') {
    pose.chest[0] = Math.sin(phase * 0.4) * 2;
    pose.leftUpperArm[2] = -6; pose.rightUpperArm[2] = 6;
  }
  if (clip === 'walk' || clip === 'run') {
    const run = clip === 'run', swing = run ? 54 : 28;
    pose.hips[1] = c * 4;
    pose.chest[0] = run ? 10 : 2;
    pose.chest[1] = -c * 7;
    pose.leftUpperLeg[0] = s * swing;
    pose.rightUpperLeg[0] = -s * swing;
    pose.leftLowerLeg[0] = -Math.max(0, -s) * (run ? 100 : 45);
    pose.rightLowerLeg[0] = -Math.max(0, s) * (run ? 100 : 45);
    pose.leftFoot[0] = Math.max(0, s) * 18;
    pose.rightFoot[0] = Math.max(0, -s) * 18;
    pose.leftUpperArm[0] = -s * swing;
    pose.rightUpperArm[0] = s * swing;
    pose.leftUpperArm[2] = -7; pose.rightUpperArm[2] = 7;
    pose.leftForeArm[0] = run ? 82 : 20;
    pose.rightForeArm[0] = run ? 82 : 20;
    lift = Math.abs(c) * (run ? 0.12 : 0.035);
  }
  if (clip === 'wave') {
    pose.rightUpperArm[2] = 145;
    pose.rightForeArm[2] = s * 24;
    pose.rightHand[2] = s * 12;
    pose.head[2] = -7;
  }
  if (clip === 'celebrate') {
    pose.leftUpperArm[2] = -145; pose.rightUpperArm[2] = 145;
    pose.leftForeArm[0] = 15 + s * 14; pose.rightForeArm[0] = 15 - s * 14;
    lift = Math.max(0, s) * 0.22;
    pose.chest[1] = s * 8;
  }
  if (clip === 'jump') {
    const T = t % 0.9;
    const air = Math.sin(Math.min(T / 0.7, 1) * Math.PI);
    const crouch = T < 0.12 ? T / 0.12 : T > 0.62 && T < 0.74 ? (0.74 - T) / 0.12 : 0;
    pose.leftUpperLeg[0] = crouch * 40 + air * 25; pose.rightUpperLeg[0] = crouch * 40 + air * 25;
    pose.leftLowerLeg[0] = -crouch * 70; pose.rightLowerLeg[0] = -crouch * 70;
    pose.leftUpperArm[2] = -30 - air * 70; pose.rightUpperArm[2] = 30 + air * 70;
    pose.leftForeArm[0] = -35; pose.rightForeArm[0] = -35;
    lift = air * 0.85 - crouch * 0.18;
  }
  if (clip === 'dance') {
    pose.hips[1] = Math.abs(s) * 9; pose.hips[0] = s * 10;
    pose.chest[1] = -s * 14; pose.chest[0] = s * 6;
    pose.leftUpperArm[2] = -85 + s * 40; pose.rightUpperArm[2] = 85 - s * 40;
    pose.leftForeArm[0] = -60 + s * 25; pose.rightForeArm[0] = -60 - s * 25;
    pose.leftUpperLeg[0] = -s * 15; pose.rightUpperLeg[0] = s * 15;
    pose.leftLowerLeg[0] = -Math.abs(s) * 20; pose.rightLowerLeg[0] = -Math.abs(s) * 20;
    lift = Math.abs(c) * 0.06;
  }
  if (clip === 'point') {
    const raise = Math.min(1, t / 0.25);
    pose.rightUpperArm[0] = -78 * raise; pose.rightForeArm[0] = -12 * raise;
    pose.rightUpperArm[2] = 38 * raise;
    pose.leftUpperArm[2] = -12; pose.leftForeArm[0] = -20;
    pose.chest[1] = 10 * raise;
  }
  if (clip === 'nod') {
    pose.head[0] = s * 13;
  }
  if (clip === 'shakehead') {
    pose.head[1] = s * 20;
  }
  if (clip === 'punch') {
    const P = t % 1.1;
    const jab = P < 0.18 ? P / 0.18 : P < 0.4 ? 1 - (P - 0.18) / 0.22 : 0;
    pose.rightUpperArm[0] = -40 - jab * 28; pose.rightUpperArm[2] = 40 - jab * 34;
    pose.rightForeArm[0] = -85 + jab * 77;
    pose.leftUpperArm[0] = -18; pose.leftUpperArm[2] = -22; pose.leftForeArm[0] = -70;
    pose.chest[1] = -jab * 28;
    pose.leftFoot[1] = jab * 6;
  }
  if (clip === 'bow') {
    let p;
    if (t < 0.45) p = t / 0.45;
    else if (t < 1.35) p = 1;
    else if (t < 1.8) p = 1 - (t - 1.35) / 0.45;
    else p = 0;
    pose.chest[0] = 43 * p; pose.head[0] = 20 * p;
    pose.leftUpperArm[0] = 28 * p; pose.rightUpperArm[0] = 28 * p;
    pose.leftUpperArm[2] = -12; pose.rightUpperArm[2] = 12;
    pose.hips[1] = -3.5 * p;
  }
  if (clip === 'sit') {
    pose.hips[1] = -32;
    pose.leftUpperLeg[0] = 83; pose.rightUpperLeg[0] = 83;
    pose.leftLowerLeg[0] = -77; pose.rightLowerLeg[0] = -77;
    pose.leftUpperArm[0] = -14; pose.rightUpperArm[0] = -14;
    pose.leftForeArm[0] = -50; pose.rightForeArm[0] = -50;
    pose.chest[0] = 4;
  }
  JOINTS.forEach(j => { pose[j] = pose[j].map(v => v * strength); });
  return { pose, lift: lift * strength };
}

export function cameraTracks(from, to, duration, ease = 'ease') {
  const tracks = {};
  ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov'].forEach((ch, i) => {
    tracks['cam.' + ch] = [{ t: 0, v: from[i], ease }, { t: duration, v: to[i], ease }];
  });
  return tracks;
}

export function exportSize(width, aspect = '16:9') {
  const [a, b] = ({ '16:9': [16, 9], '2.39:1': [2.39, 1], '9:16': [9, 16], '1:1': [1, 1] })[aspect] || [16, 9];
  return [width, Math.round(width * b / a / 2) * 2];
}
