import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudio, normalizeStudio, validateModel, newPart, modelTemplate, modelInstance, hasProductionWork, PRODUCTION_TABS } from '../production.js';

test('seven distinct production workspaces extend the original four', () => {
  assert.equal(PRODUCTION_TABS.length, 7); assert.equal(new Set(PRODUCTION_TABS).size, 7);
  assert.ok(PRODUCTION_TABS.includes('forge'));
});
test('old projects get independent empty production data', () => {
  const a = normalizeStudio(undefined), b = normalizeStudio(null);
  assert.equal(a.models.length, 0); assert.equal(a.plan.script, '');
  a.plan.tasks.push({ text: 'Only A' }); assert.equal(b.plan.tasks.length, 0);
  assert.equal(hasProductionWork(b), false);
});
test('planning-only work is protected from replacement', () => {
  const s = defaultStudio(); s.plan.script = 'A close race.'; assert.equal(hasProductionWork(s), true);
  const genre = defaultStudio(); genre.plan.genre = 'Documentary'; assert.equal(hasProductionWork(genre), true);
  const stage = defaultStudio(); stage.plan.stage = 'Production'; assert.equal(hasProductionWork(stage), true);
});
test('model-only and draft-only work is protected', () => {
  const s = defaultStudio(); s.draft.parts.push(newPart()); assert.equal(hasProductionWork(s), true);
});
test('templates return editable independent primitive parts', () => {
  for (const kind of ['trophy', 'podium', 'tree']) {
    const a = modelTemplate(kind), b = modelTemplate(kind);
    assert.ok(validateModel(a).parts.length > 1);
    a.parts[0].pos[0] = 99; assert.notEqual(b.parts[0].pos[0], 99);
  }
  assert.equal(modelTemplate('blank').parts.length, 0);
});
test('models clamp transforms and materials', () => {
  const p = newPart(); p.scale = [-4, Infinity, 500]; p.roughness = 2; p.pos = [-500, 0, 1000]; p.color = 'url(javascript:alert(1))';
  const model = validateModel({ name: 'Safe', parts: [p] });
  assert.deepEqual(model.parts[0].scale, [0.05, 1, 100]);
  assert.deepEqual(model.parts[0].pos, [-100, 0, 100]); assert.equal(model.parts[0].roughness, 1);
  assert.equal(model.parts[0].color, '#efb855');
});
test('empty, oversized and unsupported model payloads are rejected', () => {
  for (const bad of [null, {}, { parts: [] }, { parts: Array.from({ length: 101 }, () => newPart()) }, { parts: [{ type: 'script' }] }]) {
    assert.throws(() => validateModel(bad));
  }
});
test('placed models are independent snapshots', () => {
  const asset = validateModel(modelTemplate('trophy'));
  const a = modelInstance(asset), b = modelInstance(asset); asset.parts[0].color = '#000000';
  a.modelParts[0].pos[0] = 99;
  assert.notEqual(a.id, b.id); assert.notEqual(b.modelParts[0].color, '#000000'); assert.notEqual(b.modelParts[0].pos[0], 99);
});
test('project roundtrip preserves plans, models, sound and shot notes', () => {
  const studio = defaultStudio(); studio.plan.script = 'INT. STADIUM'; studio.soundNotes = 'Crowd at finish';
  studio.plan.tasks.push({ id: 't1', text: 'Build trophy', done: true }); studio.shotNotes.shot_1 = 'Track the leader';
  studio.models.push(validateModel(modelTemplate('trophy'))); studio.draft = { ...modelTemplate('tree'), assetId: 'model_1' };
  const restored = normalizeStudio(JSON.parse(JSON.stringify(studio)));
  assert.equal(restored.plan.script, studio.plan.script); assert.deepEqual(restored.plan.tasks, studio.plan.tasks);
  assert.equal(restored.models[0].id, studio.models[0].id); assert.equal(restored.soundNotes, studio.soundNotes);
  assert.equal(restored.shotNotes.shot_1, studio.shotNotes.shot_1); assert.equal(restored.draft.assetId, 'model_1');
});
test('feature-length script text survives save/load', () => {
  const s = defaultStudio(); s.plan.script = 'Scene dialogue. '.repeat(15000);
  assert.equal(normalizeStudio(JSON.parse(JSON.stringify(s))).plan.script, s.plan.script);
});
test('broken production sections cannot break legacy project loading', () => {
  const restored = normalizeStudio({ models: [null, { parts: [] }, modelTemplate('tree')], plan: { tasks: [null, { text: 'Keep' }] }, draft: { parts: [{ type: 'script' }] } });
  assert.equal(restored.models.length, 1); assert.equal(restored.plan.tasks.length, 1); assert.equal(restored.draft.parts.length, 0);
});
test('prototype keys are not retained in storyboard notes', () => {
  const restored = normalizeStudio(JSON.parse('{"shotNotes":{"__proto__":"bad","constructor":"bad","shot_1":"safe"}}'));
  assert.deepEqual(Object.keys(restored.shotNotes), ['shot_1']);
});
