import test from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_LIMITS, newBone, newPart, humanoidTemplate, blankCharacter, isPresetCompatible, boneJoints, validateCharacter } from '../charcraft.js';

const clone = o => structuredClone(o);

test('humanoid template is valid and preset-compatible', () => {
  const t = humanoidTemplate();
  const clean = validateCharacter(t);
  assert.equal(clean.kind, 'forge');
  assert.equal(isPresetCompatible(clean), true);
  assert.ok(clean.bones.length >= 15);
  assert.ok(clean.parts.length >= 10);
});

test('blank character is valid but not preset-compatible', () => {
  const b = blankCharacter();
  const clean = validateCharacter(b);
  assert.equal(isPresetCompatible(clean), false);
  assert.ok(clean.bones.length >= 1);
  assert.ok(clean.parts.length >= 1);
});

test('boneJoints lists every bone with a label', () => {
  const joints = boneJoints(humanoidTemplate());
  assert.ok(joints.length >= 15);
  for (const j of joints) {
    assert.ok(typeof j.id === 'string' && j.id);
    assert.ok(typeof j.label === 'string' && j.label);
  }
});

test('validate rejects duplicate ids', () => {
  const c = clone(humanoidTemplate());
  c.bones[1].id = c.bones[0].id;
  assert.throws(() => validateCharacter(c), /id/i);
});

test('validate rejects a bone parent cycle', () => {
  const c = blankCharacter();
  const root = c.bones[0];
  const child = newBone('child', root.id);
  c.bones.push(child);
  // point the root at its own descendant — a cycle
  root.parent = child.id;
  assert.throws(() => validateCharacter(c), /cycle|loop/i);
});

test('validate rejects a dangling parent', () => {
  const c = clone(humanoidTemplate());
  c.bones[2].parent = 'no-such-bone';
  assert.throws(() => validateCharacter(c), /parent/i);
});

test('validate enforces limits', () => {
  const c = blankCharacter();
  c.bones.push(...Array.from({ length: FORGE_LIMITS.bones }, (_, i) => newBone('b' + i, c.bones[0].id)));
  assert.throws(() => validateCharacter(c), /bone/i);
  const c2 = blankCharacter();
  c2.parts.push(...Array.from({ length: FORGE_LIMITS.parts }, (_, i) => ({ ...newPart('box', c2.bones[0].id), id: 'p' + i })));
  assert.throws(() => validateCharacter(c2), /part/i);
});

test('validate rejects bad part types, normalizes bad colors', () => {
  const c = clone(humanoidTemplate());
  c.parts[0].type = 'dodecahedron';
  assert.throws(() => validateCharacter(c), /type/i);
  const c2 = clone(humanoidTemplate());
  const clean2 = validateCharacter(c2);
  c2.parts[0].color = 'hotpink';
  const fixed = validateCharacter(c2);
  assert.equal(fixed.parts[0].color, '#e8e3d7'); // bad color falls back to the default
});

test('validate returns a deep copy — mutating it cannot corrupt the input', () => {
  const t = humanoidTemplate();
  const clean = validateCharacter(t);
  clean.bones[0].name = 'mutated';
  assert.notEqual(t.bones[0].name, 'mutated');
});

test('isPresetCompatible needs the standard bone ids', () => {
  const c = clone(humanoidTemplate());
  assert.equal(isPresetCompatible(c), true);
  c.bones.find(b => b.id === 'neck').id = 'neck2'; // neck has no parts attached
  assert.equal(isPresetCompatible(c), false);
});
