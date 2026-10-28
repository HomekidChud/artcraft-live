import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINTS, motionPose } from './motion.js?v=0.7.1';

// A real 19-bone Skeleton + weighted SkinnedMesh, with stylised rigid segments.
// Every avatar instance owns its skeleton, pose and geometry.
export function buildAvatar(rig) {
  const actor = new THREE.Group();
  const bones = {}, geometries = [], materials = [], buckets = new Map();
  const leg = rig.legsH / 96 * 0.9, arm = rig.armLen / 96 * 0.78;
  const torso = rig.torsoH / 120 * 0.68, width = rig.torsoW / 92 * 0.58;
  const hipY = leg + 0.16;
  const bone = (name, parent, pos) => {
    const b = new THREE.Bone(); b.name = name; b.position.fromArray(pos);
    (parent ? bones[parent] : actor).add(b); bones[name] = b; return b;
  };
  bone('hips', null, [0, hipY, 0]);
  bone('spine', 'hips', [0, 0.12, 0]);
  bone('chest', 'spine', [0, torso * 0.58, 0]);
  bone('neck', 'chest', [0, torso * 0.42 + 0.06, 0]);
  bone('head', 'neck', [0, 0.23, 0]);
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    bone(side + 'Shoulder', 'chest', [sign * width * 0.4, 0, 0]);
    bone(side + 'UpperArm', side + 'Shoulder', [sign * width * 0.24, 0, 0]);
    bone(side + 'ForeArm', side + 'UpperArm', [0, -arm * 0.51, 0]);
    bone(side + 'Hand', side + 'ForeArm', [0, -arm * 0.49, 0]);
    bone(side + 'UpperLeg', 'hips', [sign * width * 0.27, -0.04, 0]);
    bone(side + 'LowerLeg', side + 'UpperLeg', [0, -leg * 0.5, 0]);
    bone(side + 'Foot', side + 'LowerLeg', [0, -leg * 0.5, 0]);
  }
  actor.updateMatrixWorld(true);
  const add = (name, geometry, color, pos = [0, 0, 0], scale = [1, 1, 1]) => {
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion(), new THREE.Vector3(...scale));
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bones[name].matrixWorld, transform));
    const count = geometry.attributes.position.count, indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { indices[i * 4] = JOINTS.indexOf(name); weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometries.push(geometry);
    if (!buckets.has(color)) {
      buckets.set(color, []);
      materials.push(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02 }));
    }
    buckets.get(color).push(geometry);
  };
  const ball = () => new THREE.SphereGeometry(1, 16, 12);
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  add('hips', box(), rig.legsColor, [0, 0, 0], [width * 0.85, 0.23, 0.32]);
  add('spine', ball(), rig.torsoColor, [0, torso * 0.2, 0], [width * 0.5, torso * 0.48, 0.2]);
  add('chest', ball(), rig.torsoColor, [0, -0.015, 0], [width * 0.58, torso * 0.34, 0.22]);
  add('neck', ball(), rig.headColor, [0, 0.02, 0], [0.1, 0.14, 0.1]);
  const radius = rig.headR / 52 * 0.245;
  add('head', ball(), rig.headColor, [0, 0, 0], [radius, radius * 1.1, radius * 0.95]);
  if (rig.hairStyle !== 'bald') add('head', ball(), rig.hairColor, [rig.hairStyle === 'side' ? -0.025 : 0, radius * 0.7, -0.025], [radius * 1.02, radius * (rig.hairStyle === 'spiky' ? 0.8 : 0.5), radius * 0.94]);
  // Facial meshes live on the head bone rather than in the static batch.
  if (rig.nose) add('head', ball(), rig.headColor, [0, -radius * 0.13, radius * 0.95], [0.037, 0.043, 0.06]);
  const face = new THREE.Group();bones.head.add(face);
  const faceMesh=(color,pos,scale)=>{
    const m=new THREE.Mesh(ball(),new THREE.MeshStandardMaterial({color,roughness:0.65}));
    m.position.fromArray(pos);m.scale.fromArray(scale);face.add(m);return m;
  };
  const eyes=[],pupils=[],brows=[];
  for(const sign of [-1,1]){
    eyes.push(faceMesh(rig.eyeColor || '#fff',[sign*radius*0.4,radius*0.12,radius*0.86],[0.044,0.05,0.024]));
    pupils.push(faceMesh(rig.pupilColor || '#221a12',[sign*radius*0.4,radius*0.12,radius*0.95],[0.019,0.026,0.012]));
    brows.push(faceMesh(rig.hairColor || '#38251d',[sign*radius*0.4,radius*0.4,radius*0.86],[0.055,0.009,0.015]));
  }
  const mouth=faceMesh('#582933',[0,-radius*0.48,radius*0.83],[0.062,0.014,0.018]);
  actor.userData.face = state => {
    const happy=state.emotion==='happy',sad=state.emotion==='sad',angry=state.emotion==='angry',surprise=state.emotion==='surprised',focused=state.emotion==='focused';
    eyes.forEach((eye,i)=>{
      const open=Math.max(0.03,1-state.blink)*(happy ? 0.75 : surprise ? 1.25 : focused ? 0.78 : 1);
      eye.scale.y=0.05*open;pupils[i].scale.y=0.026*open;
      pupils[i].position.x=eye.position.x+state.gazeX*0.017;pupils[i].position.y=eye.position.y+state.gazeY*0.015;
      brows[i].rotation.z=(i===0 ? -1 : 1)*(angry ? 0.4 : sad ? -0.35 : happy ? -0.1 : focused ? 0.14 : 0);
      brows[i].position.y=radius*(surprise ? 0.55 : 0.4);
    });
    mouth.scale.set(surprise ? 0.045 : happy ? 0.08 : 0.062,0.012+state.mouth*0.085+(surprise?0.035:0),0.018);
    mouth.rotation.z=sad?0.08:0;
    actor.userData.facialState={...state};
  };
  for (const side of ['left', 'right']) {
    add(side + 'UpperArm', ball(), rig.torsoColor, [0, -arm * 0.12, 0], [0.115, arm * 0.24, 0.115]);
    add(side + 'UpperArm', ball(), rig.armColor, [0, -arm * 0.32, 0], [0.085, arm * 0.25, 0.085]);
    add(side + 'ForeArm', ball(), rig.armColor, [0, -arm * 0.22, 0], [0.073, arm * 0.27, 0.073]);
    add(side + 'Hand', ball(), rig.handColor, [0, -0.05, 0], [0.08, 0.11, 0.065]);
    add(side + 'UpperLeg', ball(), rig.legsColor, [0, -leg * 0.23, 0], [0.13, leg * 0.29, 0.135]);
    add(side + 'LowerLeg', ball(), rig.legsColor, [0, -leg * 0.22, 0], [0.1, leg * 0.28, 0.1]);
    add(side + 'Foot', box(), rig.feetColor, [0, -0.015, 0.075], [0.2, 0.13, 0.36]);
  }
  // Batch by material, not by body part, to avoid one draw call per segment.
  const batches = [...buckets.values()].map(parts => mergeGeometries(parts, false));
  const geometry = mergeGeometries(batches, true);
  geometries.forEach(g => g.dispose());
  batches.forEach(g => g.dispose());
  const skeleton = new THREE.Skeleton(JOINTS.map(j => bones[j]));
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  actor.add(mesh); mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  // Animated bounds are deliberately not cached at bind pose.
  mesh.frustumCulled = false;
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
