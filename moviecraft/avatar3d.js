import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINTS, motionPose } from './motion.js';

// Volumetric humanoids: 19-bone Skeleton + weighted SkinnedMesh, capsule limbs,
// lathed torso, articulated hands, detailed faces (ears, brows, lids, lips)
// and fabric/skin physical materials. Every avatar instance owns its skeleton,
// pose and geometry. New rig fields fall back gracefully for older projects.
export function buildAvatar(rig) {
  const actor = new THREE.Group();
  const bones = {}, geometries = [], buckets = new Map();
  const leg = rig.legsH / 96 * 0.9, arm = rig.armLen / 96 * 0.78;
  const torso = rig.torsoH / 120 * 0.68, width = rig.torsoW / 92 * 0.58;
  const bulk = Math.max(0, Math.min(1, rig.bulk ?? 0.5));
  const sw = Math.max(0.6, Math.min(1.5, (rig.shoulderW ?? 96) / 96)); // shoulder width
  const neckLen = Math.max(0.5, Math.min(1.5, rig.neckLen ?? 1));
  const handS = Math.max(0.5, Math.min(1.8, rig.handSize ?? 1));
  const footS = Math.max(0.5, Math.min(1.8, rig.footSize ?? 1));
  const radMul = 0.72 + bulk * 0.55; // bulk thickens limbs
  const hipY = leg + 0.16;
  const bone = (name, parent, pos) => {
    const b = new THREE.Bone(); b.name = name; b.position.fromArray(pos);
    (parent ? bones[parent] : actor).add(b); bones[name] = b; return b;
  };
  bone('hips', null, [0, hipY, 0]);
  bone('spine', 'hips', [0, 0.12, 0]);
  bone('chest', 'spine', [0, torso * 0.58, 0]);
  bone('neck', 'chest', [0, torso * 0.42 + 0.06, 0]);
  bone('head', 'neck', [0, 0.2 * neckLen, 0]);
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    bone(side + 'Shoulder', 'chest', [sign * width * 0.4 * sw, 0.02, 0]);
    bone(side + 'UpperArm', side + 'Shoulder', [sign * width * 0.24 * sw, -0.01, 0]);
    bone(side + 'ForeArm', side + 'UpperArm', [0, -arm * 0.51, 0]);
    bone(side + 'Hand', side + 'ForeArm', [0, -arm * 0.49, 0]);
    bone(side + 'UpperLeg', 'hips', [sign * width * 0.27, -0.04, 0]);
    bone(side + 'LowerLeg', side + 'UpperLeg', [0, -leg * 0.5, 0]);
    bone(side + 'Foot', side + 'LowerLeg', [0, -leg * 0.5, 0]);
  }
  actor.updateMatrixWorld(true);
  // finish buckets: skin / cloth / hair / default — one material per color+finish
  const FINISH = {
    skin: c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.52, clearcoat: 0.12, clearcoatRoughness: 0.55 }),
    cloth: c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.85, sheen: 0.45, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') }),
    hair: c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42 }),
    default: c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }),
  };
  const add = (name, geometry, color, pos = [0, 0, 0], scale = [1, 1, 1], finish = 'default', rotDeg = [0, 0, 0]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotDeg[0] * Math.PI / 180, rotDeg[1] * Math.PI / 180, rotDeg[2] * Math.PI / 180));
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale));
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bones[name].matrixWorld, transform));
    const count = geometry.attributes.position.count, indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { indices[i * 4] = JOINTS.indexOf(name); weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometries.push(geometry);
    const key = color + '|' + finish;
    if (!buckets.has(key)) buckets.set(key, { color, finish, parts: [] });
    buckets.get(key).parts.push(geometry);
  };
  const ball = () => new THREE.SphereGeometry(1, 20, 14);
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 10);
  const cone = (r, h) => new THREE.ConeGeometry(r, h, 10);
  const cyl = (rTop, rBot, h) => new THREE.CylinderGeometry(rTop, rBot, h, 14);
  const lathe = (profile, seg = 20) => new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), seg);

  /* ---------- pelvis & torso ---------- */
  add('hips', ball(), rig.legsColor, [0, -0.02, 0], [width * 0.34, 0.15, 0.24], 'cloth');
  add('spine', lathe([[width * 0.30, -0.04], [width * 0.335, torso * 0.25], [width * 0.35, torso * 0.5], [width * 0.33, torso * 0.6]]),
    rig.torsoColor, [0, 0, 0], [1, 1, 0.86 + bulk * 0.2], 'cloth'); // waist
  add('chest', lathe([
    [width * 0.335, -0.02], [width * 0.44, torso * 0.2], [width * 0.465, torso * 0.34],
    [width * 0.46 * sw, torso * 0.44], [width * 0.36 * sw, torso * 0.46],
  ]), rig.torsoColor, [0, 0, 0], [1, 1, 0.86 + bulk * 0.22], 'cloth'); // chest → shoulders
  add('chest', ball(), rig.torsoColor, [0, torso * 0.3, 0], [width * 0.3, torso * 0.16, 0.2 + bulk * 0.05], 'cloth'); // pectoral volume
  add('neck', cyl(0.052 * (0.9 + bulk * 0.2), 0.06, 0.2 * neckLen), rig.headColor, [0, 0.08 * neckLen, 0], [1, 1, 1], 'skin');

  /* ---------- head ---------- */
  const r = rig.headR / 52 * 0.245;
  add('head', ball(), rig.headColor, [0, r * 0.1, 0], [r, r * 1.16, r * 0.96], 'skin'); // skull
  add('head', ball(), rig.headColor, [0, -r * 0.62, r * 0.18], [r * 0.72, r * 0.52, r * 0.74], 'skin'); // jaw
  add('head', ball(), rig.headColor, [0, -r * 0.86, r * 0.5], [r * 0.16, r * 0.1, r * 0.12], 'skin'); // chin
  if (rig.ears !== false) for (const s of [-1, 1]) {
    add('head', ball(), rig.headColor, [s * r * 0.96, -r * 0.08, -r * 0.02], [0.022, 0.075, 0.05], 'skin'); // ears
  }
  const iris = rig.irisColor || '#5a4636';
  for (const s of [-1, 1]) {
    add('head', ball(), rig.eyeColor || '#f8f6f2', [s * r * 0.38, r * 0.14, r * 0.78], [0.048, 0.05, 0.042], 'default'); // eyeball
    add('head', ball(), iris, [s * r * 0.38, r * 0.14, r * 0.9], [0.026, 0.028, 0.012], 'default'); // iris
    add('head', ball(), '#140f0a', [s * r * 0.38, r * 0.14, r * 0.95], [0.013, 0.015, 0.008], 'default'); // pupil
    add('head', ball(), rig.headColor, [s * r * 0.38, r * 0.21, r * 0.8], [0.052, 0.02, 0.034], 'skin'); // upper lid
    if (rig.browStyle && rig.browStyle !== 'none') {
      const tilt = { flat: 0, raised: 0, angry: s * -22 }[rig.browStyle] || 0;
      const lift = rig.browStyle === 'raised' ? r * 0.07 : 0;
      add('head', ball(), rig.hairColor, [s * r * 0.38, r * 0.34 + lift, r * 0.8], [0.06, 0.013, 0.02], 'hair', [0, 0, tilt]); // brow
    }
  }
  if (rig.nose) {
    add('head', ball(), rig.headColor, [0, -r * 0.06, r * 0.9], [0.032, 0.055, 0.04], 'skin'); // nose bridge+tip
  }
  const lip = '#a5544a';
  if (rig.mouth === 'open') {
    add('head', ball(), '#57241e', [0, -r * 0.5, r * 0.72], [r * 0.14, r * 0.16, 0.03], 'default');
    add('head', ball(), lip, [0, -r * 0.42, r * 0.76], [r * 0.2, 0.018, 0.03], 'default');
    add('head', ball(), lip, [0, -r * 0.62, r * 0.76], [r * 0.17, 0.016, 0.03], 'default');
  } else if (rig.mouth === 'flat') {
    add('head', ball(), lip, [0, -r * 0.5, r * 0.78], [r * 0.2, 0.018, 0.03], 'default');
  } else {
    // smile / grin / sad — curved lips built from a torus arc
    const smile = rig.mouth !== 'sad';
    const arc = new THREE.TorusGeometry(r * 0.16, 0.013, 8, 18, Math.PI * 0.8);
    add('head', arc, lip, [0, -r * (smile ? 0.46 : 0.62), r * 0.74], [1, 1, 1], 'default', [smile ? -78 : 102, 0, 90]);
    if (rig.mouth === 'grin') add('head', box(), '#f6f2ea', [0, -r * 0.46, r * 0.72], [r * 0.2, 0.012, 0.02], 'default'); // teeth
  }
  /* ---------- hair ---------- */
  const cap = (sy, y, extra = {}) => add('head', ball(), rig.hairColor, [extra.x || 0, y, 0], [r * (extra.sx || 1.03), r * sy, r * (extra.sz || 1.03)], 'hair');
  const style = rig.hairStyle || 'flat';
  if (style !== 'bald') {
    if (style === 'afro') add('head', ball(), rig.hairColor, [0, r * 0.55, -r * 0.05], [r * 1.28, r * 1.22, r * 1.24], 'hair');
    else if (style === 'buzz') cap(0.28, r * 0.62);
    else if (style === 'mohawk') {
      cap(0.3, r * 0.66);
      for (let i = -2; i <= 2; i++) add('head', cone(r * 0.11, r * 0.5), rig.hairColor, [0, r * 1.0, i * r * 0.3], [1, 1, 1], 'hair', [30, 0, 0]);
    } else if (style === 'ponytail') {
      cap(0.55, r * 0.52);
      add('head', capsule(r * 0.14, r * 0.4), rig.hairColor, [0, -r * 0.15, -r * 0.95], [1, 1, 1], 'hair', [15, 0, 0]);
    } else if (style === 'long') {
      cap(0.55, r * 0.52);
      for (const s of [-1, 1]) add('head', capsule(r * 0.16, r * 0.75), rig.hairColor, [s * r * 0.78, -r * 0.35, -r * 0.25], [1, 1, 1], 'hair');
      add('head', capsule(r * 0.2, r * 0.7), rig.hairColor, [0, -r * 0.35, -r * 0.75], [1, 1, 1], 'hair');
    } else if (style === 'spiky') {
      cap(0.5, r * 0.5);
      for (let i = -2; i <= 2; i++) add('head', cone(r * 0.1, r * 0.42), rig.hairColor, [i * r * 0.34, r * 1.0, -r * 0.1], [1, 1, 1], 'hair', [-18, 0, i * 8]);
    } else if (style === 'side') {
      cap(0.5, r * 0.52, { x: -r * 0.22 });
      add('head', ball(), rig.hairColor, [-r * 0.72, r * 0.28, -r * 0.1], [r * 0.5, r * 0.62, r * 0.9], 'hair');
    } else cap(0.55, r * 0.52); // flat
  }

  /* ---------- arms & hands ---------- */
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? -1 : 1;
    add(side + 'Shoulder', ball(), rig.torsoColor, [s * 0.01, -0.015, 0], [0.085 * sw, 0.075, 0.075], 'cloth'); // deltoid
    add(side + 'UpperArm', capsule(0.052 * radMul, arm * 0.34), rig.armColor, [0, -arm * 0.26, 0], [1, 1, 1], 'skin'); // upper arm
    add(side + 'UpperArm', capsule(0.058 * radMul, arm * 0.16), rig.torsoColor, [0, -arm * 0.12, 0], [1, 1, 1], 'cloth'); // sleeve
    add(side + 'ForeArm', capsule(0.044 * radMul, arm * 0.3), rig.armColor, [0, -arm * 0.22, 0], [1, 1, 1], 'skin'); // forearm
    add(side + 'ForeArm', ball(), rig.armColor, [0, -arm * 0.02, 0], [0.05 * radMul, 0.05 * radMul, 0.05 * radMul], 'skin'); // elbow
    add(side + 'Hand', box(), rig.handColor, [0, -0.035, 0.004], [0.072 * handS, 0.082 * handS, 0.032 * handS], 'skin'); // palm
    for (let f = 0; f < 4; f++) // fingers
      add(side + 'Hand', capsule(0.0105 * handS, 0.042 * handS), rig.handColor, [(f - 1.5) * 0.021 * handS, -0.115 * handS, 0.004], [1, 1, 1], 'skin', [14, 0, 0]);
    add(side + 'Hand', capsule(0.012 * handS, 0.03 * handS), rig.handColor, [s * 0.045 * handS, -0.058 * handS, 0.014], [1, 1, 1], 'skin', [0, 0, s * 40]); // thumb
  }

  /* ---------- legs & feet ---------- */
  for (const side of ['left', 'right']) {
    add(side + 'UpperLeg', capsule(0.078 * radMul, leg * 0.3), rig.legsColor, [0, -leg * 0.24, 0], [1, 1, 1], 'cloth'); // thigh
    add(side + 'LowerLeg', cyl(0.058 * radMul, 0.042 * radMul, leg * 0.4), rig.legsColor, [0, -leg * 0.22, 0], [1, 1, 1], 'cloth'); // calf
    add(side + 'LowerLeg', ball(), rig.legsColor, [0, -leg * 0.08, 0], [0.062 * radMul, 0.07 * radMul, 0.06 * radMul], 'cloth'); // calf muscle
    add(side + 'LowerLeg', ball(), rig.legsColor, [0, -leg * 0.01, 0], [0.05 * radMul, 0.05 * radMul, 0.05 * radMul], 'cloth'); // knee
    add(side + 'Foot', box(), rig.feetColor, [0, -0.028, 0.06], [0.1 * footS, 0.062 * footS, 0.23 * footS], 'default'); // shoe
    add(side + 'Foot', ball(), rig.feetColor, [0, -0.02, 0.15 * footS], [0.05 * footS, 0.045 * footS, 0.06 * footS], 'default'); // toe cap
    add(side + 'Foot', box(), '#1c1913', [0, -0.058, 0.06], [0.104 * footS, 0.014, 0.24 * footS], 'default'); // sole
  }

  // Batch by material, not by body part, to avoid one draw call per segment.
  const batches = [...buckets.values()].map(b => mergeGeometries(b.parts, false));
  const geometry = mergeGeometries(batches, true);
  geometries.forEach(g => g.dispose());
  batches.forEach(g => g.dispose());
  const skeleton = new THREE.Skeleton(JOINTS.map(j => bones[j]));
  const mesh = new THREE.SkinnedMesh(geometry, [...buckets.values()].map(b => FINISH[b.finish](b.color)));
  actor.add(mesh); mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false; // animated bounds are deliberately not cached at bind pose
  actor.userData.bones = bones; actor.userData.skeleton = skeleton;
  actor.userData.animate = (motion, time, duration, jointValues = {}, legacyCycle = null) => {
    const { pose, lift } = motionPose(motion, time, duration);
    if (legacyCycle !== null && (!motion || motion.clip === 'none')) {
      Object.assign(pose, motionPose({ clip: 'walk' }, legacyCycle).pose);
    }
    for (const j of JOINTS) {
      bones[j].rotation.set(...pose[j].map((v, i) => (jointValues[j + '.' + ['x', 'y', 'z'][i]] ?? v) * Math.PI / 180));
    }
    bones.hips.position.y = hipY + lift;
  };
  return actor;
}
