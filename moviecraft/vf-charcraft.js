// Character Forge data model — pure, renderer-independent.
// A forge character is a rigid-part rig: an editable bone hierarchy with
// primitive parts bound to bones. Posing rotates bones; parts follow rigidly.
// This is deliberate part-based rigging, not mesh sculpting or skin weights.
import { JOINTS } from './vf-motion.js';

export const FORGE_PART_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'capsule', 'torus'];
export const FORGE_LIMITS = { bones: 64, parts: 200, boneChildren: 24 };

const makeId = p => p + '_' + Math.random().toString(36).slice(2, 10);
const num = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const vec = (v, fallback, min, max) => fallback.map((f, i) => num(v?.[i], f, min, max));
const text = (v, fallback) => typeof v === 'string' ? v.slice(0, 120) : fallback;
const hex = v => /^#[0-9a-f]{6}$/i.test(v) ? v : null;

export function newBone(name = 'Bone', parent = null) {
  return { id: makeId('bone'), name: text(name, 'Bone'), parent, pos: [0, 0.25, 0] };
}

export function newPart(type = 'box', bone = null) {
  return {
    id: makeId('fpart'), name: FORGE_PART_TYPES.includes(type) ? type[0].toUpperCase() + type.slice(1) : 'Part',
    type: FORGE_PART_TYPES.includes(type) ? type : 'box', bone,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [0.3, 0.3, 0.3],
    color: '#e8e3d7', roughness: 0.65, metalness: 0.05,
  };
}

// The editable humanoid template uses the standard joint names, so motion
// presets (walk/run/wave/celebrate) animate it out of the box.
export function humanoidTemplate() {
  const b = (id, name, parent, pos) => ({ id, name, parent, pos });
  const bones = [
    b('hips', 'Hips', null, [0, 1.02, 0]),
    b('spine', 'Spine', 'hips', [0, 0.18, 0]),
    b('chest', 'Chest', 'spine', [0, 0.22, 0]),
    b('neck', 'Neck', 'chest', [0, 0.26, 0]),
    b('head', 'Head', 'neck', [0, 0.12, 0]),
    b('leftShoulder', 'L shoulder', 'chest', [-0.17, 0.19, 0]),
    b('rightShoulder', 'R shoulder', 'chest', [0.17, 0.19, 0]),
    b('leftUpperArm', 'L upper arm', 'leftShoulder', [-0.15, 0, 0]),
    b('rightUpperArm', 'R upper arm', 'rightShoulder', [0.15, 0, 0]),
    b('leftForeArm', 'L forearm', 'leftUpperArm', [0, -0.3, 0]),
    b('rightForeArm', 'R forearm', 'rightUpperArm', [0, -0.3, 0]),
    b('leftHand', 'L hand', 'leftForeArm', [0, -0.27, 0]),
    b('rightHand', 'R hand', 'rightForeArm', [0, -0.27, 0]),
    b('leftUpperLeg', 'L thigh', 'hips', [-0.11, -0.06, 0]),
    b('rightUpperLeg', 'R thigh', 'hips', [0.11, -0.06, 0]),
    b('leftLowerLeg', 'L shin', 'leftUpperLeg', [0, -0.45, 0]),
    b('rightLowerLeg', 'R shin', 'rightUpperLeg', [0, -0.45, 0]),
    b('leftFoot', 'L foot', 'leftLowerLeg', [0, -0.45, 0]),
    b('rightFoot', 'R foot', 'rightLowerLeg', [0, -0.45, 0]),
  ];
  const p = (name, bone, pos, scale, color, type = 'box') => ({
    id: makeId('fpart'), name, type, bone, pos, rot: [0, 0, 0], scale,
    color, roughness: 0.6, metalness: 0.05,
  });
  const skin = '#f0b98c', shirt = '#5b8dd9', pants = '#42506e', shoe = '#2b2417', hair = '#3a2a1c';
  const parts = [
    p('Pelvis', 'hips', [0, 0.02, 0], [0.34, 0.24, 0.23], pants),
    p('Torso', 'chest', [0, 0.09, 0], [0.42, 0.46, 0.26], shirt),
    p('Head', 'head', [0, 0.15, 0], [0.3, 0.34, 0.31], skin, 'sphere'),
    p('Hair', 'head', [0, 0.29, -0.01], [0.32, 0.12, 0.33], hair),
    p('L eye', 'head', [-0.07, 0.18, 0.15], [0.05, 0.05, 0.03], '#241f1a', 'sphere'),
    p('R eye', 'head', [0.07, 0.18, 0.15], [0.05, 0.05, 0.03], '#241f1a', 'sphere'),
    p('L upper arm', 'leftUpperArm', [0, -0.14, 0], [0.1, 0.32, 0.1], shirt),
    p('R upper arm', 'rightUpperArm', [0, -0.14, 0], [0.1, 0.32, 0.1], shirt),
    p('L forearm', 'leftForeArm', [0, -0.13, 0], [0.09, 0.3, 0.09], skin),
    p('R forearm', 'rightForeArm', [0, -0.13, 0], [0.09, 0.3, 0.09], skin),
    p('L hand', 'leftHand', [0, -0.04, 0], [0.1, 0.11, 0.1], skin),
    p('R hand', 'rightHand', [0, -0.04, 0], [0.1, 0.11, 0.1], skin),
    p('L thigh', 'leftUpperLeg', [0, -0.21, 0], [0.14, 0.44, 0.14], pants),
    p('R thigh', 'rightUpperLeg', [0, -0.21, 0], [0.14, 0.44, 0.14], pants),
    p('L shin', 'leftLowerLeg', [0, -0.21, 0], [0.12, 0.44, 0.12], pants),
    p('R shin', 'rightLowerLeg', [0, -0.21, 0], [0.12, 0.44, 0.12], pants),
    p('L foot', 'leftFoot', [0, -0.02, 0.06], [0.12, 0.08, 0.24], shoe),
    p('R foot', 'rightFoot', [0, -0.02, 0.06], [0.12, 0.08, 0.24], shoe),
  ];
  return { kind: 'forge', name: 'New character', bones, parts };
}

export function blankCharacter() {
  return {
    kind: 'forge', name: 'New character',
    bones: [{ id: makeId('bone'), name: 'Root', parent: null, pos: [0, 0.5, 0] }],
    parts: [newPart('box', null)],
  };
}

export function isPresetCompatible(character) {
  return JOINTS.every(j => character?.bones?.some(b => b.id === j));
}

export function boneJoints(character) {
  return (character?.bones || []).map(b => ({ id: b.id, label: b.name }));
}

// Structural validation: stable ids, existing parents, no cycles, finite numbers.
// Throws with a user-readable message; returns a clean deep copy on success.
export function validateCharacter(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.bones) || !input.bones.length) {
    throw new Error('A character needs at least one bone.');
  }
  if (input.bones.length > FORGE_LIMITS.bones) throw new Error('A character supports up to ' + FORGE_LIMITS.bones + ' bones.');
  if (!Array.isArray(input.parts) || !input.parts.length) throw new Error('A character needs at least one part.');
  if (input.parts.length > FORGE_LIMITS.parts) throw new Error('A character supports up to ' + FORGE_LIMITS.parts + ' parts.');
  const bones = input.bones.map((bone, i) => {
    if (!bone || typeof bone !== 'object') throw new Error('Bad bone at position ' + (i + 1));
    return {
      id: text(bone.id, makeId('bone')), name: text(bone.name, 'Bone ' + (i + 1)),
      parent: bone.parent == null ? null : text(bone.parent),
      pos: vec(bone.pos, [0, 0.25, 0], -50, 50),
    };
  });
  const seen = new Set();
  for (const bone of bones) {
    if (seen.has(bone.id)) throw new Error('Duplicate bone id: ' + bone.id);
    seen.add(bone.id);
  }
  // parent existence + cycle check (walk up with a step bound)
  for (const bone of bones) {
    let cur = bone, steps = 0;
    while (cur.parent != null) {
      cur = bones.find(b => b.id === cur.parent);
      if (!cur) throw new Error('Bone "' + bone.name + '" points at a missing parent.');
      if (++steps > bones.length) throw new Error('Bone hierarchy contains a cycle at "' + bone.name + '".');
    }
  }
  const parts = input.parts.map((part, i) => {
    if (!part || typeof part !== 'object') throw new Error('Bad part at position ' + (i + 1));
    if (!FORGE_PART_TYPES.includes(part.type)) throw new Error('Unsupported part type at position ' + (i + 1) + '.');
    if (part.bone != null && !seen.has(part.bone)) throw new Error('Part "' + text(part.name, i + 1) + '" is bound to a missing bone.');
    return {
      id: text(part.id, makeId('fpart')), name: text(part.name, 'Part ' + (i + 1)),
      type: part.type, bone: part.bone == null ? null : text(part.bone),
      pos: vec(part.pos, [0, 0, 0], -50, 50), rot: vec(part.rot, [0, 0, 0], -360, 360),
      scale: vec(part.scale, [0.3, 0.3, 0.3], 0.02, 50),
      color: hex(part.color) || '#e8e3d7', roughness: num(part.roughness, 0.65, 0, 1), metalness: num(part.metalness, 0.05, 0, 1),
    };
  });
  const partIds = new Set(parts.map(p => p.id));
  if (partIds.size !== parts.length) throw new Error('Duplicate part ids.');
  // one parent bone should not carry an absurd number of parts
  const perBone = new Map();
  for (const part of parts) perBone.set(part.bone, (perBone.get(part.bone) || 0) + 1);
  for (const [bone, count] of perBone) if (count > FORGE_LIMITS.boneChildren * 4) throw new Error('One bone carries too many parts.');
  return { kind: 'forge', name: text(input.name, 'New character'), bones, parts };
}
