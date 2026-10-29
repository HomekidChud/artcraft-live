// Builds a forge character into a THREE.Group with a bone-hierarchy rig.
// Rigid-part rigging: bones are Object3D nodes; parts are meshes parented to
// bones. Posing rotates bones; motion presets apply only when the character
// contains the standard joint names (see isPresetCompatible).
import * as THREE from 'three';
import { motionPose, JOINTS } from './motion.js';
import { isPresetCompatible } from './charcraft.js';

const D2R = Math.PI / 180;

export function buildCharacterGroup(character) {
  const group = new THREE.Group();
  const boneNodes = new Map(); // bone id -> Object3D
  const bones = character.bones || [];
  // two passes: create nodes, then link parents (parents may be listed later)
  for (const bone of bones) {
    const node = new THREE.Object3D();
    node.name = 'bone:' + bone.id;
    node.position.fromArray(bone.pos || [0, 0, 0]);
    boneNodes.set(bone.id, node);
  }
  for (const bone of bones) {
    const node = boneNodes.get(bone.id);
    const parent = bone.parent == null ? null : boneNodes.get(bone.parent);
    (parent || group).add(node);
  }
  // parts
  const geometries = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 20, 14),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
    cone: () => new THREE.ConeGeometry(0.5, 1, 18),
    capsule: () => new THREE.CapsuleGeometry(0.25, 0.5, 6, 12),
    torus: () => new THREE.TorusGeometry(0.5, 0.18, 10, 20),
  };
  for (const part of character.parts || []) {
    const geo = (geometries[part.type] || geometries.box)();
    const mat = new THREE.MeshStandardMaterial({
      color: part.color || '#e8e3d7',
      roughness: part.roughness ?? 0.65, metalness: part.metalness ?? 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'fpart:' + part.id;
    mesh.castShadow = true;
    mesh.position.fromArray(part.pos || [0, 0, 0]);
    mesh.rotation.set(...(part.rot || [0, 0, 0]).map(r => r * D2R));
    mesh.scale.fromArray(part.scale || [0.3, 0.3, 0.3]);
    const host = part.bone == null ? null : boneNodes.get(part.bone);
    (host || group).add(mesh);
  }
  const compatible = isPresetCompatible(character);
  group.userData.bones = boneNodes; // joint editor reads live bone rotations
  group.userData.animate = (motion, time, duration, jointValues = {}) => {
    const pose = {};
    if (compatible && motion && motion.clip && motion.clip !== 'none') {
      Object.assign(pose, motionPose(motion, time, duration).pose); // standard names
    }
    for (const [id, node] of boneNodes) {
      const p = pose[id] || [0, 0, 0];
      node.rotation.set(
        (jointValues[id + '.x'] ?? p[0]) * D2R,
        (jointValues[id + '.y'] ?? p[1]) * D2R,
        (jointValues[id + '.z'] ?? p[2]) * D2R,
      );
    }
  };
  group.userData.dispose = () => {
    group.traverse(m => {
      if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); }
    });
  };
  return group;
}

// Minimal 2D preview sketch (bone lines + part blobs) for the Cast list/preview.
export function sketchCharacter(ctx, character, cx, cy, scale) {
  const bones = character.bones || [];
  const nodes = new Map(bones.map(b => [b.id, { x: b.pos[0], y: b.pos[1] }]));
  for (const bone of bones) {
    if (bone.parent == null) continue;
    const child = nodes.get(bone.id), parent = nodes.get(bone.parent);
    if (!child || !parent) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + parent.x * scale, cy - parent.y * scale);
    ctx.lineTo(cx + child.x * scale, cy - child.y * scale);
    ctx.stroke();
  }
  for (const bone of bones) {
    const n = nodes.get(bone.id); if (!n) continue;
    ctx.fillStyle = '#efb855';
    ctx.beginPath(); ctx.arc(cx + n.x * scale, cy - n.y * scale, 3, 0, Math.PI * 2); ctx.fill();
  }
  for (const part of character.parts || []) {
    const host = part.bone == null ? { x: 0, y: 0 } : nodes.get(part.bone);
    if (!host) continue;
    ctx.fillStyle = part.color || '#e8e3d7';
    ctx.globalAlpha = 0.85;
    const s = Math.max(2, (part.scale?.[0] || 0.3) * scale * 0.5);
    ctx.beginPath(); ctx.arc(cx + (host.x + (part.pos?.[0] || 0)) * scale, cy - (host.y + (part.pos?.[1] || 0)) * scale, s, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

export { JOINTS };
