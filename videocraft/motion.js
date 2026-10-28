// Deterministic, per-instance animation. No renderer or mutable asset state.
export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForeArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];
export const MOTIONS = ['none', 'idle', 'walk', 'run', 'wave', 'celebrate'];
const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
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
